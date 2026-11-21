import {
  taskErrorMessage,
  taskEventMessage,
} from "../renderer/src/lib/task-diagnostics";
import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import type { DesktopMethods, EventSink } from "../shared/contracts";
import type {
  WorkspaceData,
  TaskInput,
  LogEntry,
  TaskStatus,
  EmailConnectionOptions,
  EmailVerification,
} from "../renderer/src/types/domain";
import { BackendClient } from "./backend";
import { DesktopStore } from "./store";
import { DesktopError } from "./errors";
type RecordData = Record<string, any>;
export class DesktopService implements DesktopMethods {
  private cache?: { at: number; data: WorkspaceData };
  private loading?: Promise<WorkspaceData>;
  private localLogs: LogEntry[] = [];
  private connectionCode = "";
  private mailboxId?: string;
  constructor(
    private readonly api: BackendClient,
    private readonly store: DesktopStore,
    private readonly saveFile: (name: string, content: string) => Promise<void>,
    private readonly emit: EventSink,
  ) {}
  private notify() {
    this.cache = undefined;
    this.emit({ type: "data.changed" });
  }
  private empty(): WorkspaceData {
    return {
      tasks: [],
      proxies: [],
      profiles: [],
      accounts: [],
      email: { address: "", configured: false, status: "unknown" },
      preferences: this.store.preferences,
    };
  }
  private connection(code: string, message: string) {
    if (this.connectionCode === code) return;
    this.connectionCode = code;
    const log: LogEntry = {
      id: `desktop-${Date.now()}`,
      timestamp: new Date().toISOString(),
      level: code === "CONNECTED" ? "success" : "warn",
      category: "system",
      message,
    };
    this.localLogs = [...this.localLogs.slice(-49), log];
    this.emit({ type: "log.created", log });
  }
  getWorkspace = async (): Promise<WorkspaceData> => {
    if (this.cache && Date.now() - this.cache.at < 2000)
      return structuredClone(this.cache.data);
    if (this.loading) return this.loading;
    this.loading = this.load().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  };
  private async load(): Promise<WorkspaceData> {
    if (!this.api.configured) {
      this.connection(
        "BACKEND_NOT_CONFIGURED",
        "Backend is not configured. Close this window and open Start WeCode.cmd from the project folder.",
      );
      return this.empty();
    }
    try {
      const [tasks, proxies, profiles, accounts, mailboxes] = await Promise.all(
        [
          this.api.all("/api/v1/tasks"),
          this.api.all("/api/v1/proxies"),
          this.api.request<RecordData[]>("/api/v1/browser-profiles"),
          this.api.all("/api/v1/accounts"),
          this.api.request<RecordData[]>("/api/v1/email-configs"),
        ],
      );
      const mailbox =
        mailboxes.find(
          (m) => m.id === (this.mailboxId ?? this.store.emailConfigId),
        ) ?? (mailboxes.length === 1 ? mailboxes[0] : undefined);
      if (mailbox) this.mailboxId = mailbox.id;
      const proxyName = (id: string) => {
        const p = proxies.find((p) => p.id === id);
        return p ? `${p.host}:${p.port}` : "Auto assign";
      };
      const data: WorkspaceData = {
        preferences: {
          ...this.store.preferences,
          catchallDomain:
            mailbox?.accountDomain ?? this.store.preferences.catchallDomain,
        },
        email: mailbox
          ? {
              id: mailbox.id,
              accountDomain: mailbox.accountDomain ?? undefined,
              host: mailbox.host,
              port: mailbox.port,
              mailbox: mailbox.mailbox ?? "INBOX",
              address: mailbox.inboxAddress,
              configured: true,
              status:
                mailbox.status === "connected"
                  ? "connected"
                  : mailbox.status === "disconnected"
                    ? "disconnected"
                    : "unknown",
              lastChecked: mailbox.lastCheckedAt ?? undefined,
            }
          : { address: "", configured: false, status: "unknown" },
        tasks: tasks.map((t) => {
          const status =
            (
              {
                DRAFT: "draft",
                QUEUED: "pending",
                RUNNING: "running",
                PAUSE_REQUESTED: "running",
                PAUSED: "paused",
                SUCCEEDED: "success",
                FAILED: "failed",
                BLOCKED: "blocked",
                NEEDS_RECONCILIATION: "needs_reconciliation",
              } as Record<string, TaskStatus>
            )[t.status] ?? "failed";
          const total = t.config.count ?? 1;
          const retryable =
            Boolean(
              t.currentRun?.retryable ||
              ["OTP_AMBIGUOUS", "OTP_TIMEOUT"].includes(
                t.currentRun?.errorCode,
              ),
            ) && t.currentRun?.outcome === "NOT_CREATED";
          return {
            id: t.id,
            showBrowser:
              t.config.browser?.headless === undefined
                ? undefined
                : !t.config.browser.headless,
            batchId: t.config.batch?.id,
            batchIndex: t.config.batch?.index,
            batchSize: t.config.batch?.size,
            batchName: t.config.batch?.name,
            name: t.name,
            workflow: "Weverse Signup",
            status,
            total,
            completed: status === "success" ? total : 0,
            progress: status === "success" ? 100 : 0,
            proxy: t.config.proxyId
              ? proxyName(t.config.proxyId)
              : t.config.browser?.proxyMode === "direct"
                ? "Local (no proxy)"
                : "Auto assign",
            assignedProxy: t.config.browser?.assignedProxyId
              ? proxyName(t.config.browser.assignedProxyId)
              : undefined,
            profile:
              profiles.find((p) => p.id === t.config.browser?.profileId)
                ?.name ?? "Auto assign",
            duration: "-",
            retries: Math.max(0, t.attemptCount - 1),
            revision: t.version,
            lastErrorCode: t.currentRun?.errorCode ?? undefined,
            lastErrorMessage: taskErrorMessage(t.currentRun?.errorCode),
            businessOutcome: t.currentRun?.outcome,
            retryable,
            allowedActions:
              t.status === "DRAFT" ||
              (t.status === "SUCCEEDED" && t.currentRun?.outcome === "CREATED")
                ? ["start"]
                : t.status === "PAUSED"
                  ? ["resume"]
                  : ["RUNNING", "QUEUED"].includes(t.status)
                    ? ["pause"]
                    : ["FAILED", "BLOCKED"].includes(t.status) &&
                        retryable &&
                        t.currentRun?.outcome === "NOT_CREATED"
                      ? ["retry"]
                      : [],
          };
        }),
        proxies: proxies.map((p) => ({
          id: p.id,
          host: p.host,
          port: p.port,
          protocol: p.protocol,
          country: "-",
          health:
            p.status === "healthy"
              ? "healthy"
              : ["unhealthy", "unreachable"].includes(p.status)
                ? "unreachable"
                : "unknown",
          latency: p.latencyMs ?? null,
          assigned:
            p.activeAssignments ??
            profiles.filter(
              (f) => f.state === "leased" && f.assignedProxyId === p.id,
            ).length,
          hasCredentials: Boolean(p.hasAuthentication),
          revision: p.version ?? 1,
        })),
        profiles: profiles.map((p) => ({
          id: p.id,
          name: p.name,
          proxy: p.assignedProxyId
            ? proxyName(p.assignedProxyId)
            : "Auto assign",
          status:
            p.state === "leased"
              ? "running"
              : p.state === "quarantined"
                ? "paused"
                : "idle",
          lastActivity: p.lastActivityAt,
          cookies: 0,
        })),
        accounts: accounts.map((a) => ({
          id: a.id,
          email: a.email,
          username: a.username,
          proxy: a.proxyUsed ?? "Direct",
          createdAt: a.createdAt,
          verification:
            a.status === "verified"
              ? "verified"
              : a.status === "disabled"
                ? "failed"
                : "pending",
        })),
      };
      this.connection("CONNECTED", "Connected to the local backend.");
      this.cache = { at: Date.now(), data };
      return structuredClone(data);
    } catch (error) {
      this.connection(
        error instanceof DesktopError ? error.code : "BACKEND_UNAVAILABLE",
        "Local backend is unavailable. Start its PostgreSQL/Redis dependencies and API service.",
      );
      return this.empty();
    }
  }
  private async taskBody(input: TaskInput) {
    if (
      !["Weverse Signup", "Create Account", "create-account"].includes(
        input.workflow,
      )
    )
      throw new DesktopError(
        "WORKFLOW_UNSUPPORTED",
        "The existing backend only supports account creation tasks.",
      );
    const preferences = this.store.preferences;
    const [proxies, profiles, mailboxes] = await Promise.all([
      this.api.all("/api/v1/proxies"),
      this.api.request<RecordData[]>("/api/v1/browser-profiles"),
      this.api.request<RecordData[]>("/api/v1/email-configs"),
    ]);
    const automatic = (s: string) =>
      !s || s === "Auto assign" || s === "Direct";
    const directProxy = ["Local (no proxy)", "Direct", "Local"].includes(
      input.proxy,
    );
    const proxy =
      automatic(input.proxy) || directProxy
        ? undefined
        : proxies.find(
            (p) =>
              p.id === input.proxy || `${p.host}:${p.port}` === input.proxy,
          );
    const profile = automatic(input.profile)
      ? undefined
      : profiles.find(
          (p) => p.id === input.profile || p.name === input.profile,
        );
    if (!automatic(input.proxy) && !directProxy && !proxy)
      throw new DesktopError(
        "PROXY_NOT_FOUND",
        "Selected proxy no longer exists.",
      );
    if (!automatic(input.profile) && !profile)
      throw new DesktopError(
        "PROFILE_NOT_FOUND",
        "Selected profile no longer exists.",
      );
    if (directProxy && profile?.assignedProxyId)
      throw new DesktopError(
        "PROFILE_PROXY_CONFLICT",
        "Local mode requires a profile without an assigned proxy. Choose Auto assign for the browser profile.",
      );
    const mailbox =
      mailboxes.find(
        (m) => m.id === (this.mailboxId ?? this.store.emailConfigId),
      ) ?? (mailboxes.length === 1 ? mailboxes[0] : undefined);
    const domain = mailbox?.accountDomain ?? preferences.catchallDomain;
    if (!domain)
      throw new DesktopError(
        "CATCHALL_REQUIRED",
        "Configure an Account Email Domain before creating tasks.",
      );
    return {
      name: input.name,
      emailConfigId: mailbox?.id,
      config: {
        domain,
        count: input.total,
        password: {
          length: preferences.passwordLength,
          uppercase: preferences.uppercase,
          lowercase: true,
          numbers: preferences.numbers,
          special: preferences.symbols,
        },
        proxyId: proxy?.id,
        browser: {
          headless:
            input.showBrowser === undefined ? undefined : !input.showBrowser,
          profileId: profile?.id,
          proxyMode: directProxy ? "direct" : proxy ? "fixed" : "auto",
        },
      },
    };
  }
  createTask = async (input: TaskInput) => {
    const task = await this.taskBody({ ...input, total: 1 });
    if (input.total > 1)
      await this.api.request("/api/v1/tasks/batch", "POST", {
        batchId: input.creationId ?? randomUUID(),
        size: input.total,
        task,
      });
    else await this.api.request("/api/v1/tasks", "POST", task);
    this.notify();
  };
  updateTask = async (id: string, input: TaskInput, revision: number) => {
    const body = await this.taskBody(input);
    let update = body;
    if (input.preserveIdentity) {
      const existing = await this.api.request<RecordData>(
        `/api/v1/tasks/${id}`,
      );
      update = {
        ...body,
        emailConfigId: existing.emailConfigId ?? body.emailConfigId,
        config: {
          ...existing.config,
          proxyId: body.config.proxyId,
          browser: {
            ...existing.config.browser,
            ...body.config.browser,
            assignedProxyId:
              body.config.browser.proxyMode ===
                existing.config.browser?.proxyMode &&
              body.config.proxyId === existing.config.proxyId &&
              body.config.browser.profileId ===
                existing.config.browser?.profileId
                ? existing.config.browser?.assignedProxyId
                : undefined,
          },
        },
      };
    }
    await this.api.request(`/api/v1/tasks/${id}`, "PATCH", {
      ...update,
      version: revision,
    });
    this.notify();
  };
  deleteTask = async (id: string, revision: number) => {
    await this.api.request(`/api/v1/tasks/${id}`, "DELETE", {
      version: revision,
    });
    this.notify();
  };
  taskAction = async (
    id: string,
    action: "start" | "pause" | "resume" | "retry",
    revision: number,
  ) => {
    await this.api.request(`/api/v1/tasks/${id}/${action}`, "POST", {
      version: revision,
    });
    this.notify();
  };
  importProxies = async (
    input: Parameters<DesktopMethods["importProxies"]>[0],
  ) => {
    const result = await this.api.request<{ imported: number }>(
      "/api/v1/proxies/import",
      "POST",
      { format: "json", content: JSON.stringify(input), dryRun: false },
    );
    this.notify();
    return { imported: result.imported };
  };
  checkProxy = async (id: string) => {
    await this.api.request(`/api/v1/proxies/${id}/check`, "POST");
    this.notify();
  };
  updateProxy = async (
    id: string,
    input: Parameters<DesktopMethods["updateProxy"]>[1],
    revision: number,
  ) => {
    await this.api.request(`/api/v1/proxies/${id}`, "PATCH", {
      ...input,
      version: revision,
    });
    this.notify();
  };
  deleteProxy = async (id: string, revision: number) => {
    await this.api.request(`/api/v1/proxies/${id}`, "DELETE", {
      version: revision,
    });
    this.notify();
  };
  createProfile = async (name: string, proxy: string) => {
    const proxies = await this.api.all("/api/v1/proxies");
    const selected = proxies.find(
      (p) => p.id === proxy || `${p.host}:${p.port}` === proxy,
    );
    if (proxy && proxy !== "Auto assign" && !selected)
      throw new DesktopError(
        "PROXY_NOT_FOUND",
        "Selected proxy no longer exists.",
      );
    await this.api.request("/api/v1/browser-profiles", "POST", {
      name,
      mode: "isolated",
      proxyId: selected?.id,
    });
    this.notify();
  };
  deleteProfile = async (id: string) => {
    await this.api.request(`/api/v1/browser-profiles/${id}`, "DELETE");
    this.notify();
  };
  saveEmail = async (
    address: string,
    password?: string,
    options?: EmailConnectionOptions,
  ) => {
    const configs = await this.api.request<RecordData[]>(
      "/api/v1/email-configs",
    );
    const existing =
      configs.find(
        (c) => c.id === (this.mailboxId ?? this.store.emailConfigId),
      ) ?? configs.find((c) => c.inboxAddress === address);
    const fields = options ?? {
      accountDomain: this.store.preferences.catchallDomain || undefined,
      host: existing?.host ?? "imap.gmail.com",
      port: existing?.port ?? 993,
      mailbox: existing?.mailbox ?? "INBOX",
    };
    if (!existing && !password)
      throw new DesktopError(
        "APP_PASSWORD_REQUIRED",
        "Provide a Gmail App Password for the OTP inbox.",
      );
    const result = await this.api.request<RecordData>(
      existing
        ? `/api/v1/email-configs/${existing.id}`
        : "/api/v1/email-configs",
      existing ? "PATCH" : "POST",
      {
        inboxAddress: address,
        ...fields,
        ...(existing ? { version: existing.version } : {}),
        ...(password ? { appPassword: password } : {}),
      },
    );
    this.mailboxId = result.id;
    await this.store.selectEmailConfig(result.id);
    if (result.accountDomain)
      await this.store.savePreferences({
        ...this.store.preferences,
        catchallDomain: result.accountDomain,
      });
    this.notify();
  };
  getEmailAppPassword = async (id: string): Promise<string> => {
    const workspace = await this.getWorkspace();
    if (!workspace.email.configured || workspace.email.id !== id)
      throw new DesktopError(
        "MAILBOX_NOT_SELECTED",
        "Refresh the selected OTP inbox before loading its App Password.",
      );
    const result = await this.api.request<{ appPassword: string }>(
      `/api/v1/email-configs/${id}/app-password`,
    );
    if (
      typeof result.appPassword !== "string" ||
      result.appPassword.length > 512
    )
      throw new DesktopError(
        "INVALID_EMAIL_CREDENTIAL",
        "The saved App Password could not be loaded.",
      );
    return result.appPassword;
  };
  getEmailVerifications = async (): Promise<EmailVerification[]> => {
    if (!this.api.configured) return [];
    await this.getWorkspace();
    const id = this.mailboxId ?? this.store.emailConfigId;
    return id
      ? this.api.request<EmailVerification[]>(
          `/api/v1/email-configs/${id}/verifications`,
        )
      : [];
  };
  testEmail = async () => {
    await this.getWorkspace();
    if (!this.mailboxId)
      throw new DesktopError("MAILBOX_REQUIRED", "Configure a mailbox first.");
    await this.api.request(
      `/api/v1/email-configs/${this.mailboxId}/test`,
      "POST",
    );
    this.notify();
  };
  savePreferences = async (
    input: Parameters<DesktopMethods["savePreferences"]>[0],
  ) => {
    if (
      this.api.configured &&
      input.catchallDomain !== this.store.preferences.catchallDomain
    ) {
      const configs = await this.api.request<RecordData[]>(
        "/api/v1/email-configs",
      );
      const current =
        configs.find(
          (c) => c.id === (this.mailboxId ?? this.store.emailConfigId),
        ) ?? (configs.length === 1 ? configs[0] : undefined);
      if (current && current.accountDomain !== input.catchallDomain) {
        if (!input.catchallDomain)
          throw new DesktopError(
            "ACCOUNT_DOMAIN_REQUIRED",
            "A configured OTP inbox requires an Account Email Domain.",
          );
        await this.api.request(`/api/v1/email-configs/${current.id}`, "PATCH", {
          accountDomain: input.catchallDomain.toLowerCase(),
          version: current.version,
        });
      }
    }
    await this.store.savePreferences(input);
    this.notify();
  };
  getLogs = async (): Promise<LogEntry[]> => {
    let records: LogEntry[] = [];
    if (this.api.configured) {
      try {
        const response = await this.api.request<{ items: RecordData[] }>(
          "/api/v1/logs?page=1&limit=100",
        );
        records = response.items.map((l) => ({
          id: String(l.id),
          timestamp: l.createdAt,
          level:
            l.event === "task.succeeded"
              ? "success"
              : l.level === "error" ||
                  (l.event === "task.execution_stopped" &&
                    l.metadata?.code !== "PAUSED")
                ? "error"
                : l.level === "warn"
                  ? "warn"
                  : "info",
          taskId: l.event?.startsWith("task.")
            ? (l.entityId ?? undefined)
            : undefined,
          category: l.event?.startsWith("task.")
            ? "task"
            : ["task", "queue", "browser", "network"].includes(l.category)
              ? l.category
              : "system",
          message: taskEventMessage(
            l.event,
            typeof l.metadata?.code === "string" &&
              /^[A-Z_]{1,80}$/.test(l.metadata.code)
              ? l.metadata.code
              : undefined,
          ),
        }));
      } catch {
        /* Connection status is reported by getWorkspace. */
      }
    }
    return [...records, ...this.localLogs].sort(
      (a, b) =>
        a.timestamp.localeCompare(b.timestamp) ||
        (/^\d+$/.test(a.id) && /^\d+$/.test(b.id)
          ? BigInt(a.id) < BigInt(b.id)
            ? -1
            : BigInt(a.id) > BigInt(b.id)
              ? 1
              : 0
          : a.id.localeCompare(b.id)),
    );
  };
  private knownLogs = new Set<string>();
  poll = async () => {
    await this.getWorkspace();
    const logs = await this.getLogs();
    for (const log of logs)
      if (!this.knownLogs.has(log.id)) this.emit({ type: "log.created", log });
    this.knownLogs = new Set(logs.slice(-500).map((log) => log.id));
    this.emit({ type: "data.changed" });
  };
  exportAccounts = async (
    ids: string[],
    options?: { includePasswords: boolean },
  ) => {
    if (!ids.length)
      throw new DesktopError(
        "NO_ACCOUNTS_SELECTED",
        "Select at least one account to export.",
      );
    const raw = await this.api.request<string>(
      `/api/v1/exports/accounts?format=csv&includePasswords=${options?.includePasswords === true ? "true" : "false"}`,
      "GET",
      undefined,
      true,
    );
    const accounts = await this.api.all("/api/v1/accounts");
    const selected = new Set(ids);
    const emails = new Set(
      accounts.filter((a) => selected.has(a.id)).map((a) => a.email),
    );
    if (emails.size !== selected.size)
      throw new DesktopError(
        "ACCOUNT_SELECTION_CHANGED",
        "Some selected accounts no longer exist. Refresh before exporting.",
      );
    const rows = parse(raw, { bom: true, columns: true }) as Record<
      string,
      string
    >[];
    const filtered = rows.filter((row) => emails.has(row.email));
    if (filtered.length !== selected.size)
      throw new DesktopError(
        "ACCOUNT_SELECTION_CHANGED",
        "Account export changed. Refresh and retry.",
      );
    const headers = [
      "email",
      "username",
      "password",
      "proxy_used",
      "created_at",
      "status",
    ];
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv =
      "\uFEFF" +
      [headers, ...filtered.map((row) => headers.map((key) => row[key] ?? ""))]
        .map((row) => row.map(quote).join(","))
        .join("\r\n") +
      "\r\n";
    await this.saveFile(
      `wecode-accounts-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
    );
  };
  exportLogs = async (ids: string[]) => {
    const selected = new Set(ids);
    const logs = (await this.getLogs()).filter((l) => selected.has(l.id));
    await this.saveFile(
      "wecode.log",
      logs
        .map((l) => `${l.timestamp} [${l.level}] [${l.category}] ${l.message}`)
        .join("\n"),
    );
  };
}
