import { chmod } from "node:fs/promises";
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  packages: "external",
  format: "esm",
  platform: "node",
  sourcemap: true,
  target: "node22.5",
});

await chmod("dist/index.js", 0o755);
