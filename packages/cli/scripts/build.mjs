import { rmSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const cwd = process.cwd();
const distDir = join(cwd, "dist");

rmSync(distDir, { force: true, recursive: true });

await build({
  alias: {
    "@buildsip/agent-chat-parser": join(
      cwd,
      "../agent-chat-parser/src/index.ts",
    ),
    "@buildsip/cli-auth": join(cwd, "../cli-auth/src/index.ts"),
    "@buildsip/hooks": join(cwd, "../hooks/src/index.ts"),
  },
  bundle: true,
  entryPoints: [join(cwd, "src/index.ts")],
  format: "esm",
  outfile: join(distDir, "index.js"),
  external: [
    "@clack/prompts",
    "commander",
    "execa",
    "open",
    "picocolors",
    "zod",
  ],
  platform: "node",
  sourcemap: true,
  target: "node24",
});
