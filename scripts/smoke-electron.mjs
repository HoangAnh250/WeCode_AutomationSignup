import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
const temporary = await mkdtemp(join(tmpdir(), "wecode-electron-smoke-"));
const env = {
  ...process.env,
  NODE_ENV: "test",
  WECODE_TEST_USER_DATA_DIR: temporary,
  WECODE_BACKEND_DISABLED: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.WECODE_DEV_SERVER_URL;
if (process.env.WECODE_SMOKE_DEV === "1")
  env.WECODE_DEV_SERVER_URL = "http://127.0.0.1:5173/";
const executable = process.argv[2];
const application = await electron.launch({
  ...(executable
    ? { executablePath: resolve(executable), args: [] }
    : { args: [resolve(".")] }),
  env,
  timeout: 45000,
});
try {
  const page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForSelector("button");
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await page.getByRole("heading", { name: "Accounts", exact: true }).waitFor();
  const exposed = await page.evaluate(() => ({
    node: typeof window.require,
    process: typeof window.process,
    bridge: window.wecode?.protocolVersion,
    raw: window.wecode?.ipcRenderer,
  }));
  assert.deepEqual(exposed, {
    node: "undefined",
    process: "undefined",
    bridge: 1,
    raw: undefined,
  });
  const settings = await application.evaluate(
    ({ BrowserWindow, nativeTheme }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const p = window.webContents.getLastWebPreferences();
      return {
        sandbox: p.sandbox,
        contextIsolation: p.contextIsolation,
        nodeIntegration: p.nodeIntegration,
        webSecurity: p.webSecurity,
        min: window.getMinimumSize(),
        theme: nativeTheme.themeSource,
      };
    },
  );
  assert.deepEqual(settings, {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    min: [980, 700],
    theme: "dark",
  });
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    true,
  );
  const data = await page.evaluate(() => window.wecode.client.getWorkspace());
  assert.equal(data.accounts.length, 0);
  assert.equal(data.tasks.length, 0);
  await page.evaluate(() => window.open("https://example.com"));
  assert.equal((await application.windows()).length, 1);
  await page.evaluate(() => {
    window.location.href = "data:text/html,forbidden";
  });
  await page.waitForTimeout(150);
  assert.ok(
    page.url().startsWith(env.WECODE_DEV_SERVER_URL ?? "wecode://desktop/"),
  );
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/electron-desktop.png" });
  await page
    .getByRole("button", { name: "Email integration", exact: true })
    .click();
  await page
    .getByLabel("Account Email Domain", { exact: true })
    .fill("mytic.website");
  await page
    .getByLabel("Gmail address", { exact: true })
    .fill("alo123@gmail.com");
  assert.match(
    await page
      .getByLabel("Generated Email Preview", { exact: true })
      .inputValue(),
    /@mytic\.website$/,
  );
  await page.screenshot({
    path: "docs/screenshots/email-integration-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("heading", { name: "Email verification workflow", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "docs/screenshots/email-forwarding-flow.png" });
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  assert.equal(
    await page.getByLabel("Proxy assignment", { exact: true }).inputValue(),
    "Local (no proxy)",
  );
  await page.screenshot({ path: "docs/screenshots/task-local-mode.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real Electron window, production assets, preload, IPC, process isolation, navigation protection, dark theme and minimum dimensions.",
  );
} finally {
  await application.close();
  await rm(temporary, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}

// Exercise the unchanged React export button through real preload IPC and the native file service.
const first = randomUUID(),
  second = randomUUID();
const fixtureToken = "electron-smoke-fixture-token";
let includesPasswords = false;
let emailRecords = [];
let savedEmailConfiguration;
const blockedTaskId = randomUUID();
let manualRetryCount = 0;
const diagnosticTasks = [
  {
    id: blockedTaskId,
    name: "Blocked signup fixture",
    status: "BLOCKED",
    version: 1,
    attemptCount: 1,
    config: { count: 1, browser: { proxyMode: "direct" } },
    currentRun: {
      id: randomUUID(),
      status: "BLOCKED",
      errorCode: "WORKFLOW_NOT_CONFIGURED",
      outcome: "NOT_CREATED",
      retryable: true,
    },
  },
];
const diagnosticLogs = [
  {
    id: "1",
    entityId: blockedTaskId,
    createdAt: "2026-01-01T00:00:00Z",
    category: "task",
    level: "info",
    event: "task.worker_started",
    metadata: {},
  },
  {
    id: "2",
    entityId: blockedTaskId,
    createdAt: "2026-01-01T00:00:01Z",
    category: "task",
    level: "info",
    event: "task.workflow_check",
    metadata: {},
  },
  {
    id: "3",
    entityId: blockedTaskId,
    createdAt: "2026-01-01T00:00:02Z",
    category: "task",
    level: "error",
    event: "task.execution_stopped",
    metadata: { code: "WORKFLOW_NOT_CONFIGURED" },
  },
];

const accounts = [
  {
    id: first,
    email: "first@example.test",
    username: "first",
    status: "verified",
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: second,
    email: "second@example.test",
    username: "second",
    status: "verified",
    createdAt: "2026-01-01T00:00:00Z",
  },
];
const backend = createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${fixtureToken}`) {
    res.writeHead(401);
    res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  if (
    req.url === `/api/v1/tasks/${blockedTaskId}/retry` &&
    req.method === "POST"
  ) {
    manualRetryCount++;
    diagnosticTasks[0].status = "QUEUED";
    diagnosticTasks[0].version++;
    diagnosticTasks[0].currentRun = {
      id: randomUUID(),
      status: "QUEUED",
      errorCode: null,
      outcome: "NOT_CREATED",
      retryable: false,
    };
    res.end("{}");
    return;
  }
  if (req.url.startsWith("/api/v1/tasks")) {
    res.end(
      JSON.stringify({ items: diagnosticTasks, total: diagnosticTasks.length }),
    );
    return;
  }
  if (req.url.startsWith("/api/v1/logs")) {
    res.end(
      JSON.stringify({ items: diagnosticLogs, total: diagnosticLogs.length }),
    );
    return;
  }

  if (req.method === "POST" && req.url === "/api/v1/email-configs") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      savedEmailConfiguration = JSON.parse(Buffer.concat(chunks).toString());
      const { appPassword, ...fields } = savedEmailConfiguration;
      const record = {
        id: randomUUID(),
        ...fields,
        status: "unknown",
        version: 1,
      };
      emailRecords = [record];
      res.end(JSON.stringify(record));
    });
    return;
  }
  if (req.url === "/api/v1/email-configs") {
    res.end(JSON.stringify(emailRecords));
    return;
  }
  if (req.url.includes("/verifications")) {
    res.end("[]");
    return;
  }

  if (req.url.startsWith("/api/v1/exports/accounts")) {
    includesPasswords = req.url.includes("includePasswords=true");
    res.setHeader("Content-Type", "text/csv");
    res.end(
      "email,username,password,proxy_used,created_at,status\r\nfirst@example.test,first,Fixture!SavedPassword123,direct,2026-01-01,verified\r\nsecond@example.test,second,Excluded-password,direct,2026-01-01,verified",
    );
  } else if (req.url.startsWith("/api/v1/accounts"))
    res.end(JSON.stringify({ items: accounts, total: accounts.length }));
  else if (
    req.url === "/api/v1/browser-profiles" ||
    req.url === "/api/v1/email-configs"
  )
    res.end("[]");
  else res.end(JSON.stringify({ items: [], total: 0 }));
});
await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
const exportRoot = await mkdtemp(join(tmpdir(), "wecode-export-smoke-"));
const destination = join(exportRoot, "accounts.csv");
const connectedEnv = {
  ...env,
  WECODE_TEST_USER_DATA_DIR: exportRoot,
  WECODE_BACKEND_DISABLED: "0",
  WECODE_API_TOKEN: fixtureToken,
  WECODE_BACKEND_URL: `http://127.0.0.1:${backend.address().port}/`,
};
let connected;
try {
  connected = await electron.launch({
    ...(executable
      ? { executablePath: resolve(executable), args: [] }
      : { args: [resolve(".")] }),
    env: connectedEnv,
    timeout: 45000,
  });
  await connected.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, destination);
  const page = await connected.firstWindow();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await page.getByRole("heading", { name: "Accounts", exact: true }).waitFor();
  await page
    .getByRole("textbox", { name: "Search", exact: true })
    .fill("first@example.test");
  await page.waitForFunction(
    () => document.querySelectorAll("tbody tr").length === 1,
  );
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  let content = "";
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      content = await readFile(destination, "utf8");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.equal(includesPasswords, true);
  assert.ok(content.includes("Fixture!SavedPassword123"));
  assert.ok(!content.includes("Excluded-password"));
  const workspace = await page.evaluate(() =>
    window.wecode.client.getWorkspace(),
  );
  assert.ok(!JSON.stringify(workspace).includes("SavedPassword"));
  assert.ok(!JSON.stringify(workspace).includes(fixtureToken));
  const denied = await page.evaluate(async () => {
    try {
      await window.wecode.client.deleteTask("../not-an-id", 1);
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(denied, true);

  await page
    .getByRole("button", { name: "Email integration", exact: true })
    .click();
  await page
    .getByLabel("Account Email Domain", { exact: true })
    .fill("mytic.website");
  await page
    .getByLabel("Gmail address", { exact: true })
    .fill("alo123@gmail.com");
  await page.getByText("Advanced IMAP settings", { exact: true }).click();
  await page.getByLabel("IMAP folder", { exact: true }).fill("Verification");
  await page
    .getByLabel("App Password", { exact: true })
    .fill("abcd efgh ijkl mnop");
  await page
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await page
    .getByText("Account domain and OTP inbox settings saved.", { exact: true })
    .waitFor();
  assert.equal(savedEmailConfiguration.accountDomain, "mytic.website");
  assert.equal(savedEmailConfiguration.inboxAddress, "alo123@gmail.com");
  assert.equal(savedEmailConfiguration.mailbox, "Verification");
  assert.equal(
    await page.getByLabel("App Password", { exact: true }).inputValue(),
    "",
  );
  const settings = JSON.parse(
    await readFile(join(exportRoot, "desktop-settings.json"), "utf8"),
  );
  assert.equal(settings.emailConfigId, emailRecords[0].id);
  assert.ok(!JSON.stringify(settings).includes("abcd efgh"));

  const savedConnection = JSON.parse(
    await readFile(join(exportRoot, "backend-connection.json"), "utf8"),
  );
  assert.equal(savedConnection.version, 1);
  assert.equal(typeof savedConnection.tokenCipher, "string");
  assert.ok(!JSON.stringify(savedConnection).includes(fixtureToken));
  await connected.close();
  connected = undefined;
  const restartEnv = { ...connectedEnv };
  delete restartEnv.WECODE_API_TOKEN;
  delete restartEnv.WECODE_BACKEND_URL;
  connected = await electron.launch({
    ...(executable
      ? { executablePath: resolve(executable), args: [] }
      : { args: [resolve(".")] }),
    env: restartEnv,
    timeout: 45000,
  });
  const restarted = await connected.firstWindow();
  await restarted
    .getByRole("button", { name: "Accounts", exact: true })
    .click();
  await restarted.getByText("first@example.test", { exact: true }).waitFor();
  const restored = await restarted.evaluate(() =>
    window.wecode.client.getWorkspace(),
  );
  assert.equal(restored.accounts.length, 2);

  await restarted.getByRole("button", { name: "Tasks", exact: true }).click();
  await restarted
    .getByText("WORKFLOW_NOT_CONFIGURED", { exact: true })
    .waitFor();
  assert.ok(
    await restarted
      .getByRole("button", {
        name: "retry Blocked signup fixture",
        exact: true,
      })
      .isEnabled(),
  );
  await restarted.screenshot({
    path: "docs/screenshots/task-blocked-diagnostic.png",
  });
  await restarted
    .getByRole("button", { name: "retry Blocked signup fixture", exact: true })
    .click();
  await restarted
    .getByRole("row")
    .filter({ hasText: "Blocked signup fixture" })
    .getByText("pending", { exact: true })
    .waitFor();
  assert.equal(manualRetryCount, 1);
  await restarted.getByRole("button", { name: "Logs", exact: true }).click();
  await restarted
    .getByRole("button", { name: /Execution stopped.*WORKFLOW_NOT_CONFIGURED/ })
    .click();
  await restarted.getByRole("dialog", { name: "Log event details" }).waitFor();
  assert.ok(
    (await restarted.getByRole("dialog").innerText()).includes(
      "browser was not opened",
    ),
  );
  await restarted.screenshot({ path: "docs/screenshots/task-log-details.png" });
  console.log(
    "PASS: blocked reason visible, safe Retry requeues via IPC, worker stages appear in Logs and full diagnostics open.",
  );
  console.log(
    "PASS: encrypted Windows backend connection survives app restart without WECODE_API_TOKEN or URL environment variables.",
  );
  console.log(
    "PASS: actual Electron email UI -> IPC -> separate domain/inbox IMAP configuration -> persisted mailbox selection; App Password cleared.",
  );
  console.log(
    "PASS: unchanged React export -> validated IPC -> authenticated backend -> selected-row CSV with saved password -> native file writer; invalid IPC rejected.",
  );
} finally {
  await connected?.close();
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
  await rm(exportRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
