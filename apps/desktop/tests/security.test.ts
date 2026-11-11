import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { args, defaults } from "../shared/contracts";
import { trustedDocument, assetPath, csp } from "../main/security";
import { BackendClient } from "../main/backend";
import { DesktopStore } from "../main/store";
import { DesktopService } from "../main/service";
describe("Electron security and desktop adapter", () => {
  it("accepts only the application document and exact development origin", () => {
    assert.equal(trustedDocument("wecode://desktop/index.html"), true);
    for (const url of [
      "https://example.com",
      "file:///index.html",
      "wecode://evil/index.html",
      "wecode://desktop/other.html",
      "http://127.0.0.1:5173.evil/",
    ])
      assert.equal(trustedDocument(url), false);
    assert.equal(
      trustedDocument("http://127.0.0.1:5173/", "http://127.0.0.1:5173/"),
      true,
    );
    assert.equal(
      trustedDocument("http://localhost:5173/", "http://127.0.0.1:5173/"),
      false,
    );
    assert.ok(csp().includes("connect-src 'none'"));
  });
  it("validates IPC arguments and rejects path-like identifiers", () => {
    assert.equal(
      args.deleteTask.safeParse(["../../secrets", 1]).success,
      false,
    );
    assert.equal(args.deleteTask.safeParse([randomUUID(), 1]).success, true);
    assert.equal(
      args.taskAction.safeParse([randomUUID(), "executeScript", 1]).success,
      false,
    );
    assert.equal(
      args.savePreferences.safeParse([{ ...defaults, passwordLength: 2 }])
        .success,
      false,
    );
    assert.equal(
      args.exportAccounts.safeParse([
        [randomUUID()],
        { includePasswords: true },
      ]).success,
      true,
    );
  });
  it("serves assets only from the renderer root", () => {
    const root = join(tmpdir(), "wecode-test-assets");
    assert.equal(
      assetPath(root, "wecode://desktop/assets/main.js"),
      join(root, "assets", "main.js"),
    );
    assert.equal(
      assetPath(root, "wecode://desktop/%2e%2e%5csecret"),
      undefined,
    );
    assert.equal(assetPath(root, "file:///private"), undefined);
    assert.equal(assetPath(root, "wecode://desktop/%00.txt"), undefined);
  });
  it("rejects remote or credential-bearing backend URLs", () => {
    for (const url of [
      "https://example.com/",
      "http://localhost/",
      "http://127.0.0.1.evil/",
      "http://user:password@127.0.0.1/",
      "http://127.0.0.1/path",
    ])
      assert.throws(() => new BackendClient(url, "secret"));
  });
  it("persists desktop preferences without storing backend credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "wecode-store-test-"));
    try {
      const file = join(root, "prefs.json");
      const first = new DesktopStore(file);
      await first.load();
      await first.savePreferences({
        ...defaults,
        catchallDomain: "example.test",
      });
      const second = new DesktopStore(file);
      await second.load();
      assert.equal(second.preferences.catchallDomain, "example.test");
      assert.equal((await readFile(file, "utf8")).includes("apiToken"), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("renders an empty disconnected workspace instead of simulated success", async () => {
    const service = new DesktopService(
      new BackendClient("http://127.0.0.1:4317/"),
      new DesktopStore("unused"),
      async () => {},
      () => {},
    );
    const data = await service.getWorkspace();
    assert.equal(data.accounts.length, 0);
    assert.equal(data.tasks.length, 0);
    await assert.rejects(service.createProfile("profile", "Auto assign"), {
      code: "BACKEND_NOT_CONFIGURED",
    });
    assert.ok(
      (await service.getLogs()).some((l) =>
        l.message.includes("not configured"),
      ),
    );
  });
  it("forwards explicit password export intent, filters selected IDs and sanitizes errors", async () => {
    const first = randomUUID(),
      second = randomUUID();
    let full = false,
      saved = "";
    const token = "fixture-token-only";
    const server = createServer((req, res) => {
      assert.equal(req.headers.authorization, `Bearer ${token}`);
      res.setHeader("Content-Type", "application/json");
      if (req.url?.startsWith("/api/v1/exports/accounts")) {
        full = req.url.includes("includePasswords=true");
        res.setHeader("Content-Type", "text/csv");
        res.end(
          "email,username,password,proxy_used,created_at,status\r\nfirst@example.test,first," +
            (full ? "Fixture!Password123" : "********") +
            ",direct,2026-01-01,verified\r\nsecond@example.test,second,DO-NOT-EXPORT,direct,2026-01-01,verified",
        );
      } else if (req.url?.startsWith("/api/v1/accounts"))
        res.end(
          JSON.stringify({
            items: [
              { id: first, email: "first@example.test" },
              { id: second, email: "second@example.test" },
            ],
            total: 2,
          }),
        );
      else {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            error: {
              code: "INVALID_STATE",
              message: "Secret should not escape: " + token,
            },
          }),
        );
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const api = new BackendClient(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/`,
        token,
      );
      const service = new DesktopService(
        api,
        new DesktopStore("unused"),
        async (_name, content) => {
          saved = content;
        },
        () => {},
      );
      await service.exportAccounts([first], { includePasswords: true });
      assert.equal(full, true);
      assert.ok(saved.includes("Fixture!Password123"));
      assert.ok(!saved.includes("DO-NOT-EXPORT"));
      assert.equal(saved.charCodeAt(0), 0xfeff);
      await assert.rejects(
        api.request("/api/v1/invalid"),
        (error: Error) =>
          !error.message.includes(token) &&
          error.message.includes("INVALID_STATE"),
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("persists the selected OTP inbox and sends the account domain for signup tasks", async () => {
    const root = await mkdtemp(join(tmpdir(), "wecode-email-store-"));
    const first = randomUUID(),
      second = randomUUID();
    let posted: any;
    const mailboxes = [
      {
        id: first,
        inboxAddress: "alo123@gmail.com",
        accountDomain: "mytic.website",
        host: "imap.gmail.com",
        port: 993,
        mailbox: "Verification",
        status: "connected",
        version: 1,
      },
      {
        id: second,
        inboxAddress: "other@gmail.com",
        accountDomain: "other.example",
        host: "imap.gmail.com",
        port: 993,
        mailbox: "INBOX",
        status: "unknown",
        version: 1,
      },
    ];
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (
        req.method === "POST" &&
        (req.url === "/api/v1/tasks" || req.url === "/api/v1/tasks/batch")
      ) {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => {
          posted = JSON.parse(Buffer.concat(chunks).toString());
          res.end("{}");
        });
        return;
      }
      if (req.url?.startsWith("/api/v1/proxies")) {
        res.end(
          JSON.stringify({
            items: [
              {
                id: randomUUID(),
                host: "192.0.2.1",
                port: 8080,
                protocol: "http",
                status: "healthy",
              },
            ],
            total: 1,
          }),
        );
        return;
      }
      if (req.url === `/api/v1/email-configs/${first}/app-password`) {
        res.end(JSON.stringify({ appPassword: "FixtureOnlyPassword123" }));
        return;
      }
      if (req.url === "/api/v1/email-configs")
        res.end(JSON.stringify(mailboxes));
      else if (req.url === "/api/v1/browser-profiles") res.end("[]");
      else res.end(JSON.stringify({ items: [], total: 0 }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const file = join(root, "settings.json");
      const initial = new DesktopStore(file);
      await initial.load();
      await initial.selectEmailConfig(first);
      await initial.savePreferences({
        ...defaults,
        catchallDomain: "legacy.example",
      });
      const restored = new DesktopStore(file);
      await restored.load();
      expectId(restored.emailConfigId, first);
      const api = new BackendClient(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/`,
        "fixture-token",
      );
      const service = new DesktopService(
        api,
        restored,
        async () => {},
        () => {},
      );
      const data = await service.getWorkspace();
      assert.equal(data.email.address, "alo123@gmail.com");
      assert.equal(
        await service.getEmailAppPassword(first),
        "FixtureOnlyPassword123",
      );
      await assert.rejects(service.getEmailAppPassword(second));
      const reopenedStore = new DesktopStore(file);
      await reopenedStore.load();
      const reopened = new DesktopService(
        api,
        reopenedStore,
        async () => {},
        () => {},
      );
      assert.equal(
        await reopened.getEmailAppPassword(first),
        "FixtureOnlyPassword123",
      );
      assert.ok(!JSON.stringify(data).includes("FixtureOnlyPassword123"));
      assert.ok(
        !(await readFile(file, "utf8")).includes("FixtureOnlyPassword123"),
      );
      assert.equal(data.preferences.catchallDomain, "mytic.website");
      await service.createTask({
        name: "Create Account",
        workflow: "Weverse Signup",
        total: 1,
        proxy: "Auto assign",
        profile: "Auto assign",
      });
      assert.equal(posted.emailConfigId, first);
      assert.equal(posted.config.domain, "mytic.website");
      assert.equal(posted.config.browser.proxyMode, "auto");
      await service.createTask({
        name: "Local Task",
        workflow: "Weverse Signup",
        total: 1,
        proxy: "Local (no proxy)",
        profile: "Auto assign",
      });
      assert.equal(posted.config.browser.proxyMode, "direct");
      assert.equal(posted.config.proxyId, undefined);
      const batchId = randomUUID();
      await service.createTask({
        name: "Ten accounts",
        workflow: "Weverse Signup",
        total: 10,
        proxy: "Local (no proxy)",
        profile: "Auto assign",
        creationId: batchId,
        showBrowser: true,
      });
      assert.equal(posted.batchId, batchId);
      assert.equal(posted.size, 10);
      assert.equal(posted.task.config.count, 1);
      assert.equal(posted.task.config.browser.headless, false);

      assert.ok(!JSON.stringify(posted).includes("alo123@gmail.com"));
      assert.ok(!JSON.stringify(posted).includes("legacy.example"));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
    function expectId(actual: unknown, expected: string) {
      assert.equal(actual, expected);
    }
  });
  it("maps blocked/uncertain outcomes, safe Retry and readable live diagnostics without leaking metadata", async () => {
    const blocked = randomUUID(),
      uncertain = randomUUID();
    const at = "2026-01-01T00:00:00Z";
    let retried = "";
    const tasks = [
      {
        id: blocked,
        name: "Blocked",
        status: "BLOCKED",
        config: { count: 1, browser: { proxyMode: "direct" } },
        attemptCount: 1,
        version: 2,
        currentRun: {
          id: randomUUID(),
          errorCode: "WORKFLOW_NOT_CONFIGURED",
          retryable: true,
          outcome: "NOT_CREATED",
        },
      },
      {
        id: uncertain,
        name: "Uncertain",
        status: "NEEDS_RECONCILIATION",
        config: { count: 1 },
        attemptCount: 1,
        version: 2,
        currentRun: {
          errorCode: "BUSINESS_OUTCOME_UNKNOWN",
          retryable: false,
          outcome: "UNKNOWN",
        },
      },
    ];
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url?.endsWith("/retry")) {
        retried = req.url;
        res.end("{}");
      } else if (req.url?.startsWith("/api/v1/tasks"))
        res.end(JSON.stringify({ items: tasks, total: tasks.length }));
      else if (req.url?.startsWith("/api/v1/logs"))
        res.end(
          JSON.stringify({
            items: [
              {
                id: "2",
                entityId: blocked,
                createdAt: at,
                level: "info",
                category: "audit",
                event: "task.execution_stopped",
                metadata: {
                  code: "WORKFLOW_NOT_CONFIGURED",
                  apiToken: "DO-NOT-EXPOSE",
                  otp: "123456",
                },
              },
              {
                id: "1",
                entityId: blocked,
                createdAt: at,
                level: "info",
                category: "task",
                event: "task.worker_started",
                metadata: {},
              },
            ],
            total: 2,
          }),
        );
      else if (
        req.url === "/api/v1/email-configs" ||
        req.url === "/api/v1/browser-profiles"
      )
        res.end("[]");
      else res.end(JSON.stringify({ items: [], total: 0 }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const events: any[] = [];
      const service = new DesktopService(
        new BackendClient(
          `http://127.0.0.1:${(server.address() as { port: number }).port}/`,
          "fixture-token",
        ),
        new DesktopStore("unused"),
        async () => {},
        (e) => events.push(e),
      );
      const data = await service.getWorkspace();
      assert.equal(data.tasks[0].status, "blocked");
      assert.deepEqual(data.tasks[0].allowedActions, ["retry"]);
      assert.ok(
        data.tasks[0].lastErrorMessage?.includes("browser was not opened"),
      );
      assert.equal(data.tasks[1].status, "needs_reconciliation");
      assert.deepEqual(data.tasks[1].allowedActions, []);
      const logs = await service.getLogs();
      assert.ok(
        logs
          .find((l) => l.id === "2")
          ?.message.includes("WORKFLOW_NOT_CONFIGURED"),
      );
      assert.equal(logs.find((l) => l.id === "2")?.level, "error");
      assert.equal(logs.find((l) => l.id === "2")?.category, "task");
      assert.ok(!JSON.stringify(logs).includes("DO-NOT-EXPOSE"));
      assert.ok(!JSON.stringify(logs).includes("123456"));
      assert.ok(
        logs.findIndex((l) => l.id === "1") <
          logs.findIndex((l) => l.id === "2"),
      );
      await service.poll();
      await service.poll();
      assert.equal(events.filter((e) => e.log?.id === "2").length, 1);
      await service.taskAction(blocked, "retry", 2);
      assert.equal(retried, `/api/v1/tasks/${blocked}/retry`);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
