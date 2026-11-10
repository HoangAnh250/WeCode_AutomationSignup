import { build } from "esbuild";
import { spawn } from "node:child_process";
await build({
  entryPoints: ["apps/desktop/tests/security.test.ts"],
  outfile: "apps/desktop/dist/security.test.cjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  logLevel: "warning",
});
const child = spawn(
  process.execPath,
  ["--test", "apps/desktop/dist/security.test.cjs"],
  { stdio: "inherit", windowsHide: true },
);
child.on("exit", (code) => (process.exitCode = code ?? 1));
