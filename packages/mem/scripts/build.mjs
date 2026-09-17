import { chmod, readFile } from "node:fs/promises";
import { build } from "esbuild";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  // Bundle JIT workspace code; only runtime dependencies remain external.
  external: Object.keys(pkg.dependencies),
  format: "esm",
  platform: "node",
  sourcemap: true,
  target: "node22.5",
});

await chmod("dist/index.js", 0o755);
