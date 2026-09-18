import { isInside } from "@buildsip/file-utils";
import type { Command } from "commander";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { findStores } from "../find-stores";
import { loadMemories } from "../load-memories";
import { NAMES } from "../names";
import { resolveRepo } from "../resolve-repo";
import { resolveMemoryFile } from "../resolve-memory-file";

/**
 * Deletes selected memory folders, including their attachments.
 * Validates the whole selection first: protected memories cannot be deleted, and
 * nested memories must be selected explicitly before deleting their parent.
 *
 * @returns Deleted memory directory paths, ordered with descendants before parents.
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
  if (!paths.length) throw new Error("Provide at least one memory directory path to delete.");
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
    const canonical = await resolveMemoryFile({ path: input, repo: workspace.repo });
    const memory = byPath.get(canonical);
    if (!memory) {
      throw new Error(
        `Choose a memory directory inside a repo or package .memories/data store in ${workspace.repo}: ${input}`,
      );
    }
    if (memory.frontmatter.doNotDelete) {
      throw new Error(
        `You cannot delete this memory because doNotDelete is true: ${dirname(canonical)}. Ask the user to delete it.`,
      );
    }
    if (dirname(canonical) === join(memory.project, NAMES.MEMORIES, NAMES.DATA)) {
      throw new Error(`You cannot delete the ${NAMES.DATA} directory itself.`);
    }
    selected.add(canonical);
  }
  for (const path of selected) {
    const folder = dirname(path);
    for (const memory of memories) {
      if (isInside({ path: memory.path, parent: folder }) && !selected.has(memory.path)) {
        throw new Error(
          `Select nested memory explicitly before deleting its parent: ${dirname(memory.path)}`,
        );
      }
    }
  }
  // Descendant paths are longer: delete them before removing their parent folders.
  const deleted = [...selected].map((path) => dirname(path)).sort((a, b) => b.length - a.length);
  for (const path of deleted) await rm(path, { recursive: true, force: true });
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
      "Memory directories returned by memory commands; repeatable.",
    )
    .action(async (options: { roots: string[]; repo: string; path: string[] }) => {
      const result = await deleteMemories({ ...options, paths: options.path });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    });
}
