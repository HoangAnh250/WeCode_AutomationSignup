import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { Config } from '../core/config.js';
import type { BrowserLease, BrowserProxy, StorageState } from './contracts.js';
import { Semaphore, bounded, abortError } from './async.js';
import { AppError } from '../core/errors.js';
interface Slot {
  id: string;
  busy: boolean;
  browser?: Browser;
  context?: BrowserContext;
  close?: () => Promise<void>;
  poisoned: boolean;
  headless?: boolean;
}
export class BrowserManager {
  private readonly admission: Semaphore;
  private readonly slots: Slot[];
  private stopping = false;
  private readonly acquiring = new Set<Promise<BrowserLease>>();
  constructor(
    private readonly config: Pick<
      Config,
      | 'BROWSER_POOL_SIZE'
      | 'BROWSER_CHANNEL'
      | 'BROWSER_HEADLESS'
      | 'BROWSER_ACQUIRE_TIMEOUT_MS'
      | 'BROWSER_ACTION_TIMEOUT_MS'
      | 'BROWSER_NAVIGATION_TIMEOUT_MS'
    >,
  ) {
    this.admission = new Semaphore(config.BROWSER_POOL_SIZE);
    this.slots = Array.from({ length: config.BROWSER_POOL_SIZE }, () => ({
      id: randomUUID(),
      busy: false,
      poisoned: false,
    }));
  }
  get status() {
    return {
      ...this.admission.status,
      processes: this.slots.filter((s) => s.browser?.isConnected() || s.context).length,
      poisoned: this.slots.filter((s) => s.poisoned).length,
    };
  }
  acquire(input: {
    mode: 'isolated' | 'persistent';
    headless?: boolean;
    directory?: string;
    proxy?: BrowserProxy;
    state?: StorageState;
    signal: AbortSignal;
  }): Promise<BrowserLease> {
    const work = this.open(input);
    this.acquiring.add(work);
    void work.then(
      () => this.acquiring.delete(work),
      () => this.acquiring.delete(work),
    );
    return work;
  }
  private async open(input: {
    mode: 'isolated' | 'persistent';
    headless?: boolean;
    directory?: string;
    proxy?: BrowserProxy;
    state?: StorageState;
    signal: AbortSignal;
  }): Promise<BrowserLease> {
    const release = await this.admission.acquire(
      input.signal,
      this.config.BROWSER_ACQUIRE_TIMEOUT_MS,
    );
    const slot = this.slots.find((s) => !s.busy && !s.poisoned);
    if (!slot) {
      release();
      throw new AppError(
        'BROWSER_POOL_UNAVAILABLE',
        'All browser slots are quarantined.',
        503,
        false,
      );
    }
    slot.busy = true;
    let context: BrowserContext | undefined;
    let closeOwned: (() => Promise<void>) | undefined;
    let releasing = false;
    let closed = false;
    const controller = new AbortController();
    const launch = {
      headless: input.headless ?? this.config.BROWSER_HEADLESS,
      channel: this.config.BROWSER_CHANNEL === 'chromium' ? undefined : this.config.BROWSER_CHANNEL,
      timeout: 30000,
    };
    const proxy = input.proxy
      ? {
          server: input.proxy.server,
          username: input.proxy.username,
          password: input.proxy.password,
        }
      : undefined;
    const onAbort = () => {
      controller.abort();
      if (slot.close) void slot.close().catch(() => {});
    };
    input.signal.addEventListener('abort', onAbort, { once: true });
    try {
      if (input.signal.aborted || this.stopping) throw abortError();
      if (input.mode === 'persistent') {
        if (!input.directory)
          throw new AppError(
            'PROFILE_DIRECTORY_REQUIRED',
            'Persistent mode requires an owned profile directory.',
            500,
          );
        if (slot.browser) {
          await bounded(slot.browser.close(), 10000, 'BROWSER_CLOSE_TIMEOUT');
          slot.browser = undefined;
        }
        context = await chromium.launchPersistentContext(input.directory, {
          ...launch,
          proxy,
          acceptDownloads: false,
          serviceWorkers: 'block',
        });
        slot.browser = context.browser() ?? undefined;
        if (input.state) await context.setStorageState(input.state);
      } else {
        if (slot.browser?.isConnected() && slot.headless !== launch.headless) {
          await bounded(slot.browser.close(), 10000, 'BROWSER_CLOSE_TIMEOUT');
          slot.browser = undefined;
        }
        if (!slot.browser?.isConnected()) slot.browser = await chromium.launch(launch);
        context = await slot.browser.newContext({
          proxy,
          storageState: input.state,
          acceptDownloads: false,
          serviceWorkers: 'block',
        });
      }
      slot.headless = launch.headless;
      slot.context = context;
      context.setDefaultTimeout(this.config.BROWSER_ACTION_TIMEOUT_MS);
      context.setDefaultNavigationTimeout(this.config.BROWSER_NAVIGATION_TIMEOUT_MS);
      const owned = context;
      const disconnect = () => {
        if (!releasing) controller.abort();
      };
      owned.on('close', disconnect);
      const browser = owned.browser();
      browser?.on('disconnected', disconnect);
      let closePromise: Promise<void> | undefined;
      const close = () =>
        (closePromise ??= (async () => {
          releasing = true;
          try {
            await bounded(
              owned.close({ reason: 'Execution resource release' }),
              10000,
              'BROWSER_CLOSE_TIMEOUT',
            );
            closed = true;
            slot.context = undefined;
            if (input.mode === 'persistent') slot.browser = undefined;
          } catch {
            slot.poisoned = true;
            controller.abort();
            try {
              if (browser) await bounded(browser.close(), 5000, 'BROWSER_CLOSE_TIMEOUT');
              closed = true;
              slot.context = undefined;
              slot.browser = undefined;
            } catch {
              /* Keep this slot occupied; the old process is not confirmed closed. */
            }
            throw new AppError(
              'BROWSER_CLOSE_UNCONFIRMED',
              'Browser shutdown was not clean; profile requires reconciliation.',
              503,
              false,
            );
          } finally {
            input.signal.removeEventListener('abort', onAbort);
            owned.off('close', disconnect);
            browser?.off('disconnected', disconnect);
            slot.close = undefined;
            if (closed) {
              slot.busy = false;
              if (!slot.poisoned) release();
            }
          }
        })());
      closeOwned = close;
      slot.close = close;
      if (input.signal.aborted || this.stopping) {
        await close();
        throw abortError();
      }
      const page = owned.pages()[0] ?? (await owned.newPage());
      return {
        id: slot.id,
        context: owned,
        page,
        signal: controller.signal,
        version: browser?.version() ?? 'unknown',
        close,
      };
    } catch (error) {
      input.signal.removeEventListener('abort', onAbort);
      if (!closeOwned) {
        try {
          if (context) await bounded(context.close(), 10000, 'BROWSER_CLOSE_TIMEOUT');
          else if (input.mode === 'persistent' && slot.browser)
            await bounded(slot.browser.close(), 10000, 'BROWSER_CLOSE_TIMEOUT');
          slot.context = undefined;
          slot.busy = false;
          release();
        } catch {
          slot.poisoned = true;
          throw new AppError(
            'BROWSER_CLOSE_UNCONFIRMED',
            'Browser cleanup could not be confirmed after launch failure.',
            503,
            false,
          );
        }
      } else {
        try {
          await closeOwned();
        } catch {
          throw new AppError(
            'BROWSER_CLOSE_UNCONFIRMED',
            'Browser cleanup could not be confirmed.',
            503,
            false,
          );
        }
      }
      if (error instanceof AppError) throw error;
      throw new AppError(
        'BROWSER_LAUNCH_FAILED',
        'Chromium could not be started or its context could not be created.',
        503,
        true,
      );
    }
  }
  async close() {
    if (this.stopping) return;
    this.stopping = true;
    this.admission.close();
    await Promise.allSettled([...this.acquiring]);
    await Promise.allSettled(
      this.slots.map(async (slot) => {
        if (slot.close) await slot.close();
        if (slot.browser?.isConnected())
          await bounded(slot.browser.close(), 10000, 'BROWSER_CLOSE_TIMEOUT');
        slot.browser = undefined;
      }),
    );
  }
}
