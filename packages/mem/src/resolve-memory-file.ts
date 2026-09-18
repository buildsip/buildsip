import { assertNoSymlinks, lstatIfExists } from "@buildsip/file-utils";
import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { NAMES } from "./names";

/** Resolves a public memory directory to its file for internal reads and lookup. */
export async function resolveMemoryFile({ path: target, repo }: { path: string; repo: string }) {
  if (typeof target !== "string" || !target.trim() || target.includes("\0")) {
    throw new Error("Provide --path with a nonempty memory directory path without NUL characters.");
  }
  // Relative paths follow the working directory for both CLI and MCP callers.
  const path = resolve(target);
  await assertNoSymlinks({ path, base: repo });
  const info = await lstatIfExists({ path });
  if (info && !info.isDirectory()) {
    throw new Error(
      `Provide --path with an existing memory directory containing ${NAMES.MEMORY_MD}, not a file: ${target}`,
    );
  }
  const file = join(path, NAMES.MEMORY_MD);
  // Check the file separately so a valid directory cannot hide a symlinked memory.md.
  await assertNoSymlinks({ path: file, base: repo });
  if (!(await lstatIfExists({ path: file }))?.isFile()) {
    throw new Error(
      `No memory exists at ${path}. Search again and use its current directory path.`,
    );
  }
  return realpath(file);
}
