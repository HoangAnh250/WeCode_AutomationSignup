import { taskEvent } from '../core/task-events.js';
import type { EmailVerificationCoordinator } from './EmailVerificationCoordinator.js';
import { errors } from 'playwright';
import type { Database } from '../infrastructure/database.js';
import type { Logger } from '../infrastructure/logger.js';
import type { Config } from '../core/config.js';
import type { AccountManager } from '../services/account.service.js';
import type { AutomationExecutor, ExecutionContext } from '../queue/executor.js';
import { taskConfigSchema, browserTaskSchema, accountCreateSchema } from '../contracts/schemas.js';
import { AppError, PauseSignal } from '../core/errors.js';
import type { BrowserManager } from './BrowserManager.js';
import type { ProfileManager } from './ProfileManager.js';
import type { ProxyAssignmentService } from './ProxyAssignmentService.js';
import type { ProxyRotationService } from './ProxyRotationService.js';
import type { SessionManager } from './SessionManager.js';
import type { StorageStateManager } from './StorageStateManager.js';
import type { WorkflowRegistry } from './WorkflowRegistry.js';
import type {
  BrowserLease,
  ProfileLease,
  ProxyLease,
  BrowserWorkflowContext,
} from './contracts.js';
import { bounded } from './async.js';
export interface EngineDependencies {
  db: Database;
  logger: Logger;
  config: Config;
  accounts: AccountManager;
  emailVerification: EmailVerificationCoordinator;
  browsers: BrowserManager;
  profiles: ProfileManager;
  assignments: ProxyAssignmentService;
  rotation: ProxyRotationService;
  sessions: SessionManager;
  storage: StorageStateManager;
  workflows: WorkflowRegistry;
}
export class WorkerExecutor implements AutomationExecutor {
  constructor(private readonly deps: EngineDependencies) {}
  async execute(execution: ExecutionContext): Promise<void> {
    const d = this.deps;
    await execution.assertCanContinue();
    const task = await d.db.task.findUniqueOrThrow({ where: { id: execution.taskId } });
    const run = await d.db.taskRun.findUniqueOrThrow({ where: { id: execution.runId } });
    if (run.outcome === 'CREATED') {
      const saved = await d.db.account.findFirst({
        where: { taskRun: { taskId: task.id } },
        select: { id: true },
      });
      if (!saved)
        throw new AppError(
          'CREATED_RESULT_MISSING',
          'An existing business result requires reconciliation.',
          409,
          false,
        );
      d.logger.info(
        { event: 'automation.already_committed', runId: execution.runId, accountId: saved.id },
        'Confirmed account already exists; no external action repeated.',
      );
      return;
    }
    if (run.outcome !== 'NOT_CREATED')
      throw new AppError(
        'BUSINESS_OUTCOME_UNKNOWN',
        'External result must be reconciled before browser execution.',
        409,
        false,
      );
    await taskEvent(d.db, 'task.workflow_check', execution.taskId, execution.runId);
    const workflow = d.workflows.get(task.workflow);
    await taskEvent(d.db, 'task.workflow_available', execution.taskId, execution.runId);
    const config = taskConfigSchema.parse(execution.config);
    const options = browserTaskSchema.parse(config.browser ?? {});
    // A single run has a single business-commit fence. Batch orchestration creates child tasks.
    if (config.count !== 1)
      throw new AppError(
        'BATCH_REQUIRES_CHILD_TASKS',
        'Schedule one account per task run; batch orchestration must create separate tasks.',
        422,
      );
    const owner = { runId: execution.runId, token: execution.leaseToken };
    let profile: ProfileLease | undefined,
      proxy: ProxyLease | undefined,
      browser: BrowserLease | undefined;
    let quarantine = false,
      completed = false,
      monitor: NodeJS.Timeout | undefined,
      ticking: Promise<void> | undefined;
    const controller = new AbortController();
    let stopReason: unknown;
    const stop = (reason: unknown) => {
      if (controller.signal.aborted) return;
      stopReason = reason;
      controller.abort();
    };
    const shutdown = () =>
      stop(new AppError('WORKER_SHUTDOWN', 'Worker shutdown requested.', 503, true));
    execution.signal.addEventListener('abort', shutdown, { once: true });
    if (execution.signal.aborted) shutdown();
    const check = async () => {
      if (controller.signal.aborted) throw stopReason;
      await execution.assertCanContinue();
      if (profile) await d.profiles.repository.owned(profile);
      if (proxy) await d.assignments.assertOwned(proxy);
      if (controller.signal.aborted) throw stopReason;
    };
    const guarded: ExecutionContext = {
      ...execution,
      signal: controller.signal,
      assertCanContinue: check,
      saveCheckpoint: async (value) => {
        await check();
        await execution.saveCheckpoint(value);
      },
      beforeExternalMutation: async () => {
        await check();
        await execution.beforeExternalMutation();
      },
    };
    const deadline = setTimeout(
      () =>
        stop(
          new AppError(
            'EXECUTION_TIMEOUT',
            'Browser workflow exceeded its execution deadline.',
            504,
            true,
          ),
        ),
      d.config.BROWSER_EXECUTION_TIMEOUT_MS,
    );
    deadline.unref();
    try {
      await check();
      await taskEvent(d.db, 'task.resources_waiting', execution.taskId, execution.runId);
      profile = await d.profiles.acquire(
        owner,
        options.profileId,
        execution.taskId,
        options.profileMode,
      );
      const p = await d.profiles.repository.owned(profile);
      const explicitDirect = config.browser?.proxyMode === 'direct';
      if (explicitDirect && config.proxyId)
        throw new AppError(
          'INVALID_PROXY_CONFIGURATION',
          'Local mode cannot specify a proxy ID.',
          422,
        );
      if (
        explicitDirect &&
        profile.assignedProxyId &&
        (options.profileId || p.stateVersion > 0 || profile.mode === 'persistent')
      )
        throw new AppError(
          'PROFILE_PROXY_CONFLICT',
          'Local mode requires a profile without a bound proxy.',
          422,
        );
      const sticky = Boolean(
        options.profileId ||
        p.stateVersion > 0 ||
        profile.mode === 'persistent' ||
        options.sessionId,
      );
      const configuredId =
        config.proxyId ?? (sticky ? (profile.assignedProxyId ?? undefined) : undefined);
      const mode = explicitDirect ? 'direct' : configuredId ? 'fixed' : options.proxyMode;
      const preferredId =
        configuredId ??
        (!options.rotateOnFailure ? (profile.assignedProxyId ?? undefined) : undefined);
      if (mode === 'fixed' && !preferredId)
        throw new AppError('PROXY_REQUIRED', 'Fixed proxy mode requires a proxy assignment.', 422);
      if (
        options.rotateOnFailure &&
        (profile.mode === 'persistent' || options.sessionId || p.stateVersion > 0)
      )
        throw new AppError(
          'STICKY_PROFILE_ROTATION',
          'Rotation cannot be enabled for a persistent or saved session identity.',
          422,
        );
      const choice = await d.rotation.preferredForRetry(
        execution.runId,
        preferredId,
        options.rotateOnFailure,
        mode,
      );
      proxy = await d.rotation.next(owner, { mode, ...choice });
      await d.profiles.repository.bindProxy(profile, proxy?.proxy.id ?? null);
      let lastRenew = Date.now();
      const tick = async () => {
        try {
          await check();
          if (Date.now() - lastRenew > (d.config.BROWSER_LEASE_SECONDS * 1000) / 3) {
            const ok = await d.profiles.renew(profile!);
            const proxyOk = !proxy || (await d.assignments.renew(proxy));
            if (!ok || !proxyOk)
              throw new AppError(
                'RESOURCE_LEASE_LOST',
                'Execution lost its browser or proxy lease.',
                409,
                false,
              );
            lastRenew = Date.now();
          }
        } catch (error) {
          if (error instanceof PauseSignal && browser) {
            try {
              await bounded(
                d.storage.capture(profile!, browser.context, browser.version),
                3000,
                'PAUSE_SNAPSHOT_TIMEOUT',
              );
            } catch {
              d.logger.warn(
                { event: 'automation.pause_snapshot_failed', runId: execution.runId },
                'Browser state could not be captured before pause.',
              );
            }
          }
          stop(error);
        }
      };
      monitor = setInterval(() => {
        if (!ticking)
          ticking = tick().finally(() => {
            ticking = undefined;
          });
      }, 500);
      monitor.unref();
      const snapshot = options.sessionId
        ? await d.sessions.load(options.sessionId, profile)
        : undefined;
      const state = snapshot?.state ?? (await d.storage.load(profile));
      browser = await d.browsers.acquire({
        mode: profile.mode,
        directory: profile.mode === 'persistent' ? await d.profiles.directory(profile) : undefined,
        proxy: proxy?.proxy,
        state,
        signal: controller.signal,
      });
      await taskEvent(d.db, 'task.browser_opened', execution.taskId, execution.runId, {
        mode: profile.mode,
        connection: proxy ? 'proxy' : 'local',
      });
      const disconnected = () =>
        stop(
          new AppError(
            'BROWSER_DISCONNECTED',
            'Browser context disconnected during execution.',
            503,
            true,
          ),
        );
      browser.signal.addEventListener('abort', disconnected, { once: true });
      if (browser.signal.aborted) disconnected();
      const context: BrowserWorkflowContext = {
        execution: guarded,
        page: browser.page,
        context: browser.context,
        signal: controller.signal,
        profileId: profile.id,
        restoredAccountId: snapshot?.accountId,
        waitForOtp: d.emailVerification.bind(guarded, task.emailConfigId, config.domain),
      };
      let rejectStop: ((reason: unknown) => void) | undefined;
      const stopped = new Promise<never>((_, reject) => {
        rejectStop = reject;
      });
      const onStop = () => rejectStop?.(stopReason);
      controller.signal.addEventListener('abort', onStop, { once: true });
      const work = (async () => {
        await check();
        if (snapshot) {
          if (
            !workflow.validateSession ||
            !(await workflow.validateSession(context, snapshot.accountId))
          )
            throw new AppError(
              'SESSION_AUTHENTICATION_FAILED',
              'Restored state did not pass the workflow authentication check.',
              409,
            );
        }
        await taskEvent(d.db, 'task.workflow_started', execution.taskId, execution.runId);
        return workflow.execute(context);
      })();
      try {
        if (controller.signal.aborted) onStop();
        const result = await Promise.race([work, stopped]);
        await check();
        const account = accountCreateSchema.parse({
          ...result.account,
          taskRunId: execution.runId,
          proxyUsed: proxy?.proxy.server,
        });
        const saved = await d.accounts.create(account, execution.leaseToken);
        await taskEvent(d.db, 'task.account_saved', execution.taskId, execution.runId);
        await d.sessions.save(
          profile,
          browser.context,
          browser.version,
          saved.id,
          result.sessionExpiresAt,
        );
        await taskEvent(d.db, 'task.session_saved', execution.taskId, execution.runId);
        await guarded.saveCheckpoint({
          accountId: saved.id,
          profileId: profile.id,
          stage: 'account-saved',
        });
        completed = true;
        d.logger.info(
          { event: 'automation.completed', runId: execution.runId, profileId: profile.id },
          'Browser workflow completed.',
        );
      } finally {
        controller.signal.removeEventListener('abort', onStop);
        browser.signal.removeEventListener('abort', disconnected);
        if (controller.signal.aborted) {
          try {
            await browser.close();
          } catch {
            quarantine = true;
          }
          try {
            await bounded(
              work.then(
                () => undefined,
                () => undefined,
              ),
              5000,
              'WORKFLOW_DID_NOT_STOP',
            );
          } catch {
            quarantine = true;
          }
        }
      }
    } catch (error) {
      if (error instanceof AppError && error.code === 'BROWSER_CLOSE_UNCONFIRMED')
        quarantine = true;
      if (controller.signal.aborted && stopReason) throw stopReason;
      if (error instanceof errors.TimeoutError)
        throw new AppError(
          'BROWSER_OPERATION_TIMEOUT',
          'Browser operation exceeded its timeout.',
          504,
          true,
        );
      throw error;
    } finally {
      clearTimeout(deadline);
      if (monitor) clearInterval(monitor);
      if (ticking) await ticking;
      execution.signal.removeEventListener('abort', shutdown);
      if (browser) {
        try {
          await browser.close();
        } catch {
          quarantine = true;
        }
      }
      if (proxy && !quarantine) {
        try {
          const run = await d.db.taskRun.findUnique({
            where: { id: execution.runId },
            select: { outcome: true },
          });
          if (
            !(await d.assignments.release(
              proxy,
              completed
                ? 'completed'
                : run?.outcome === 'NOT_CREATED'
                  ? 'failed-before-commit'
                  : 'stopped-after-commit',
            ))
          )
            quarantine = true;
        } catch {
          quarantine = true;
        }
      }
      if (profile) {
        try {
          if (!(await d.profiles.release(profile, quarantine))) quarantine = true;
        } catch {
          quarantine = true;
        }
      }
      if (quarantine) {
        d.logger.error(
          { event: 'automation.quarantined', runId: execution.runId, profileId: profile?.id },
          'Resource cleanup could not be confirmed; manual reconciliation is required.',
        );
        throw new AppError(
          'RESOURCE_QUARANTINED',
          'Browser or resource ownership requires manual reconciliation.',
          503,
          false,
        );
      }
    }
  }
}
