import { assertNoSymlinks, isInside } from "@buildsip/file-utils";
import type { Command } from "commander";
import { lstat, realpath, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { findStores } from "../find-stores";
import { loadMemories } from "../load-memories";
import { NAMES } from "../names";
import { resolveRepo } from "../resolve-repo";

/**
 * Deletes selected memory folders, including their attachments.
 * Validates the whole selection first: protected memories cannot be deleted, and
 * nested memories must be selected explicitly before deleting their parent.
 *
 * @returns Deleted memory.md paths, ordered with descendants before parents.
 */
export async function deleteMemories({
  roots,
  repo,
  paths,
}: {
  roots: string[];
  repo: string;
  paths: string[];
}) {
  if (!paths.length) throw new Error("At least one memory path is required.");
  const workspace = await resolveRepo({ roots, repo });
  const { stores } = await findStores({
    repo: workspace.repo,
    project: workspace.repo,
  });
  const memories = await loadMemories({
    stores,
    repo: workspace.repo,
  });
  const byPath = new Map(memories.map((memory) => [memory.path, memory]));
  const selected = new Set<string>();
  // Validate the whole batch before deleting anything, including protected descendants.
  for (const input of paths) {
    const path = resolve(input);
    await assertNoSymlinks({ path, base: workspace.repo });
    const info = await lstat(path);
    const file = info.isDirectory() ? join(path, NAMES.MEMORY_MD) : path;
    await assertNoSymlinks({ path: file, base: workspace.repo });
    if (basename(file) !== NAMES.MEMORY_MD) {
      throw new Error(`Expected a ${NAMES.MEMORY_MD} file or its directory: ${input}`);
    }
    const canonical = await realpath(file);
    const memory = byPath.get(canonical);
    if (!memory) {
      throw new Error(`Path is not a memory in repo: ${input}`);
    }
    if (memory.frontmatter.doNotDelete) {
      throw new Error(
        `You cannot delete this memory because doNotDelete is true: ${file}. Ask the user to delete it.`,
      );
    }
    if (dirname(file) === join(memory.project, NAMES.MEMORIES, NAMES.DATA)) {
      throw new Error(`You cannot delete the ${NAMES.DATA} directory itself.`);
    }
    selected.add(canonical);
  }
  for (const path of selected) {
    const folder = dirname(path);
    for (const memory of memories) {
      if (isInside({ path: memory.path, parent: folder }) && !selected.has(memory.path)) {
        throw new Error(
          `Select nested memory explicitly before deleting its parent: ${memory.path}`,
        );
      }
    }
  }
  // Descendant paths are longer: delete them before removing their parent folders.
  const deleted = [...selected].sort((a, b) => b.length - a.length);
  for (const path of deleted) await rm(dirname(path), { recursive: true, force: true });
  return deleted;
}

export function registerDeleteCommand({ program }: { program: Command }) {
  program
    .command("delete")
    .requiredOption(
      "--roots <path...>",
      "Workspace directories; repeat the flag or provide multiple paths.",
    )
    .requiredOption("--repo <path>", "Git root of the workspace project the agent is working on.")
    .description("Delete memories and their attachments by path, respecting doNotDelete.")
    .requiredOption(
      "--path <path...>",
      "Paths returned by search, or their memory directories; repeatable.",
    )
    .action(async (options: { roots: string[]; repo: string; path: string[] }) => {
      const result = await deleteMemories({ ...options, paths: options.path });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    });
}
