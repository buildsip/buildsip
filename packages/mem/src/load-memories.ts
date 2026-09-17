import { assertNoSymlinks } from "@buildsip/file-utils";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Memory } from "./memory";
import { NAMES } from "./names";
import { readConfig } from "./read-config";
import { readMemory } from "./read-memory";

/**
 * Loads memory.md files beneath each store's .memories/data directory.
 * Missing data directories are empty stores; temporary memory directories are skipped.
 *
 * `availableToWorkspaceOnly` includes stores only when their repo root sets
 * `availableToWorkspace` to true.
 * Reads validate built-in fields while preserving custom fields from older schemas.
 */
export async function loadMemories({
  stores,
  repo,
  availableToWorkspaceOnly = false,
}: {
  stores: string[];
  repo: string;
  availableToWorkspaceOnly?: boolean;
}) {
  const memories: Memory[] = [];
  for (const project of stores) {
    const { availableToWorkspace } = await readConfig({ project, repo });
    if (availableToWorkspaceOnly && !availableToWorkspace) continue;
    const data = join(project, NAMES.MEMORIES, NAMES.DATA);
    await assertNoSymlinks({ path: data, base: repo });
    const dirs = [data];
    const files: string[] = [];
    // Pushing child directories extends this queue; the loop visits them without recursion.
    for (const dir of dirs) {
      // withFileTypes tells us which entries are directories without a separate stat per entry.
      const entries = await readdir(dir, { withFileTypes: true }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        },
      );
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(NAMES.MEM_PREFIX)) dirs.push(path);
        else if (entry.isFile() && entry.name === NAMES.MEMORY_MD) files.push(path);
      }
    }
    files.sort();
    // Bound open file handles even when a store contains thousands of memories.
    for (let offset = 0; offset < files.length; offset += 50) {
      memories.push(
        ...(await Promise.all(
          files.slice(offset, offset + 50).map((path) =>
            readMemory({
              path,
              project,
              repo,
            }),
          ),
        )),
      );
    }
  }
  return memories;
}
