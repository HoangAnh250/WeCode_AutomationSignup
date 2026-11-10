import { AppError } from '../core/errors.js';
export function abortError() {
  return new AppError('EXECUTION_ABORTED', 'Execution was interrupted.', 503, true);
}
export async function bounded<T>(work: Promise<T>, ms: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new AppError(code, 'The browser operation exceeded its deadline.', 503, true)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export class Semaphore {
  private active = 0;
  private closed = false;
  private readonly waiters: {
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
    cleanup: () => void;
  }[] = [];
  constructor(
    readonly capacity: number,
    private readonly maxWaiting = 64,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid pool capacity.');
  }
  acquire(signal: AbortSignal, timeoutMs: number): Promise<() => void> {
    if (this.closed)
      return Promise.reject(new AppError('BROWSER_POOL_CLOSED', 'Browser pool is closed.', 503));
    if (signal.aborted) return Promise.reject(abortError());
    if (this.active < this.capacity) {
      this.active++;
      return Promise.resolve(this.releaseHandle());
    }
    if (this.waiters.length >= this.maxWaiting)
      return Promise.reject(
        new AppError('BROWSER_POOL_BUSY', 'Browser pool admission limit reached.', 503, true),
      );
    return new Promise((resolve, reject) => {
      const entry = {
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', cancel);
        },
      };
      const remove = (error: Error) => {
        const index = this.waiters.indexOf(entry);
        if (index >= 0) {
          this.waiters.splice(index, 1);
          entry.cleanup();
          reject(error);
        }
      };
      const cancel = () => remove(abortError());
      const timer = setTimeout(
        () =>
          remove(
            new AppError('BROWSER_POOL_TIMEOUT', 'No browser slot became available.', 503, true),
          ),
        timeoutMs,
      );
      signal.addEventListener('abort', cancel, { once: true });
      this.waiters.push(entry);
    });
  }
  private releaseHandle() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next && !this.closed) {
        next.cleanup();
        next.resolve(this.releaseHandle());
      } else this.active--;
    };
  }
  close() {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.cleanup();
      waiter.reject(new AppError('BROWSER_POOL_CLOSED', 'Browser pool closed while waiting.', 503));
    }
  }
  get status() {
    return {
      capacity: this.capacity,
      active: this.active,
      waiting: this.waiters.length,
      closed: this.closed,
    };
  }
}
