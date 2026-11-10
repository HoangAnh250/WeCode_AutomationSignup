import { build } from "esbuild";
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  logLevel: "info",
  sourcemap: false,
};
await Promise.all([
  build({
    ...common,
    entryPoints: ["apps/desktop/main/index.ts"],
    outfile: "apps/desktop/dist/main.cjs",
  }),
  build({
    ...common,
    entryPoints: ["apps/desktop/preload/index.ts"],
    outfile: "apps/desktop/dist/preload.cjs",
  }),
]);
