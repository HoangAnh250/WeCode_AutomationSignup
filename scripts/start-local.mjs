import { spawn, spawnSync } from "node:child_process";
import { readFile, mkdir, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { parse } from "dotenv";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
const root = fileURLToPath(new URL("../", import.meta.url));
const backend = join(root, "processes", "backend");
async function main() {
  const config = parse(await readFile(join(backend, ".env")));
  if (!config.API_TOKEN || !config.REDIS_URL)
    throw new Error("Backend .env is incomplete.");
  const host = config.HOST ?? "127.0.0.1";
  const base = `http://${host === "::1" ? "[::1]" : host}:${config.PORT ?? "4317"}`;
  const headers = { Authorization: `Bearer ${config.API_TOKEN}` };
  const ready = async () => {
    try {
      const response = await fetch(base + "/health/ready", {
        headers,
        signal: AbortSignal.timeout(1500),
      });
      if (response.status === 401)
        throw new Error("A different backend token is using this port.");
      return response.ok;
    } catch (error) {
      if (error.message?.includes("different backend")) throw error;
      return false;
    }
  };
  if (!(await ready())) {
    const compose = spawnSync(
      "docker",
      ["compose", "-f", join(backend, "compose.yaml"), "up", "-d", "--wait"],
      { cwd: root, stdio: "inherit", windowsHide: true },
    );
    if (compose.status !== 0)
      throw new Error("Start Docker Desktop, then run this launcher again.");
    const logs = join(backend, ".runtime");
    await mkdir(logs, { recursive: true });
    async function service(file, name) {
      const stdout = await open(join(logs, name + ".stdout.log"), "a");
      const stderr = await open(join(logs, name + ".stderr.log"), "a");
      const child = spawn(process.execPath, [join(backend, "dist", file)], {
        cwd: backend,
        env: { ...process.env, ...config },
        detached: true,
        windowsHide: true,
        stdio: ["ignore", stdout.fd, stderr.fd],
      });
      child.unref();
      await stdout.close();
      await stderr.close();
    }
    await service("server.js", "api");
    let running = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await ready()) {
        running = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!running)
      throw new Error(
        "Backend did not become ready. See processes/backend/.runtime logs.",
      );
  }
  // Do not start another queue worker when an existing worker owns this installation queue.
  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  redis.on("error", () => {});
  const queue = new Queue("account-creation", {
    connection: redis,
    prefix: `wecode-${config.INSTALLATION_ID ?? "local-desktop"}`,
  });
  try {
    await queue.waitUntilReady();
    const workers = await queue.getWorkers();
    if (!workers.length) {
      const logs = join(backend, ".runtime");
      await mkdir(logs, { recursive: true });
      const stdout = await open(join(logs, "worker.stdout.log"), "a");
      const stderr = await open(join(logs, "worker.stderr.log"), "a");
      const child = spawn(
        process.execPath,
        [join(backend, "dist", "worker.js")],
        {
          cwd: backend,
          env: { ...process.env, ...config },
          detached: true,
          windowsHide: true,
          stdio: ["ignore", stdout.fd, stderr.fd],
        },
      );
      child.unref();
      await stdout.close();
      await stderr.close();
    }
  } finally {
    await queue.close();
    redis.disconnect();
  }
  if (process.argv[2] === "--services-only") {
    console.log("Local backend and queue worker are ready.");
    return;
  }
  const version = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ).version;
  const compiled = process.argv[2] === "--compiled";
  const executable = resolve(
    compiled
      ? join(root, "node_modules/electron/dist/electron.exe")
      : (process.argv[2] ??
          join(root, "release", `WeCode-${version}-Portable-x64.exe`)),
  );
  const env = {
    ...process.env,
    WECODE_API_TOKEN: config.API_TOKEN,
    WECODE_BACKEND_URL: base + "/",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.WECODE_BACKEND_DISABLED;
  const child = spawn(executable, compiled ? [root] : [], {
    cwd: root,
    env,
    detached: true,
    windowsHide: false,
    stdio: "ignore",
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  console.log(
    "Backend ready. Opened WeCode with an authenticated local connection.",
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
