import { findUp, lstatIfExists } from "@buildsip/file-utils";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { NAMES } from "./names";

/**
 * Walks up from `path` looking for a `.git` file or directory.
 *
 * This used to spawn `git rev-parse --show-toplevel`, which paid process
 * startup to print one path. A few `lstat`s are enough for a normal clone,
 * worktree, or submodule.
 *
 * It does not honor `GIT_DIR`, `core.worktree`, or Git's stop at a filesystem mount.
 */
export async function findRepo(path: string) {
  const start = await realpath(path).catch((cause) => {
    throw new Error(`Expected a Git working tree: ${path}`, { cause });
  });
  const repo = await findUp({
    path: start,
    test: async (parent) => Boolean(await lstatIfExists({ path: join(parent, NAMES.GIT) })),
  });
  if (!repo) throw new Error(`Expected a Git working tree: ${path}`);
  return repo;
}
