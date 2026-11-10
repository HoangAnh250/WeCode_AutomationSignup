import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import electron from "electron";
const root = fileURLToPath(new URL("../", import.meta.url));
const children = new Set();
let stopping = false;
function start(command, args, cwd = root, extra = {}, visible = false) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: "inherit",
    windowsHide: !visible,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}
function finished(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Process exited with ${code}`)),
    );
  });
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  await Promise.race([
    Promise.all(
      [...children].map(
        (child) => new Promise((resolve) => child.once("exit", resolve)),
      ),
    ),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  process.exit(code);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
try {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(
        new Error(
          "Port 5173 is occupied. Stop the old browser preview before npm run dev.",
        ),
      ),
    );
    server.listen(5173, "127.0.0.1", () => server.close(resolve));
  });
  await finished(start(process.execPath, ["scripts/build-electron.mjs"]));
  const vite = start(
    process.execPath,
    [
      resolve(root, "node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      "5173",
      "--strictPort",
    ],
    resolve(root, "apps/desktop/renderer"),
  );
  vite.once("exit", () => {
    if (!stopping) void stop(1);
  });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:5173/", {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (!ready) throw new Error("React dev server did not become ready.");
  const app = start(
    electron,
    [root],
    root,
    {
      WECODE_DEV_SERVER_URL: "http://127.0.0.1:5173/",
    },
    true,
  );
  app.once("error", (error) => {
    console.error(error.message);
    void stop(1);
  });
  app.once("exit", (code) => void stop(code ?? 1));
} catch (error) {
  console.error(error.message);
  await stop(1);
}
