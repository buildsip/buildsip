import { assertNoSymlinks, isInside, lstatIfExists } from "@buildsip/file-utils";
import type { Command } from "commander";
import { realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { z } from "zod";
import { findRepo } from "../find-repo";
import { findStores } from "../find-stores";
import { loadMemories } from "../load-memories";
import { NAMES } from "../names";
import { parseValue } from "../parse-value";
import { placeMemory } from "../place-memory";
import { readJsonInput } from "../read-json-input";
import { resolveRepo } from "../resolve-repo";
import { saveMemory } from "../save-memory";
import { updateSchema } from "../update-schema";

/**
 * Updates only supplied fields on an existing memory; its stored ID never changes.
 * Even a path-only update repairs the title folder and returns the resulting path in an array.
 */
export async function update({
  roots,
  repo,
  ...value
}: z.infer<typeof updateSchema> & {
  roots: string[];
  repo: string;
}) {
  const input = parseValue({ schema: updateSchema, value, label: "update input" });
  const workspace = await resolveRepo({ roots, repo });
  // Relative paths follow the CLI working directory, just like delete paths and --input.
  const path = resolve(input.path);
  await assertNoSymlinks({ path, base: workspace.repo });
  const info = await lstatIfExists({ path });
  const file = info?.isDirectory() ? join(path, NAMES.MEMORY_MD) : path;
  await assertNoSymlinks({ path: file, base: workspace.repo });
  if (basename(file) !== NAMES.MEMORY_MD) {
    throw new Error(
      `Provide the path to an existing ${NAMES.MEMORY_MD} file or its directory: ${input.path}`,
    );
  }
  if (!(await lstatIfExists({ path: file }))?.isFile()) {
    throw new Error(
      `No memory exists at ${file}. Search again and use its current path; use insert to create a new memory.`,
    );
  }
  const canonical = await realpath(file);
  if ((await findRepo(dirname(canonical))) !== workspace.repo) {
    throw new Error(
      `Choose a memory in ${workspace.repo}; ${input.path} belongs to a different Git repository.`,
    );
  }
  const { stores } = await findStores({ repo: workspace.repo, project: workspace.repo });
  const memories = await loadMemories({ stores, repo: workspace.repo, validateConfig: false });
  const existing = memories.find((memory) => memory.path === canonical);
  if (!existing) {
    throw new Error(
      `Choose a memory path inside a repo or package .memories/data store in ${workspace.repo}: ${input.path}`,
    );
  }
  if (existing.frontmatter.doNotEdit) {
    throw new Error(
      `You cannot edit this memory because doNotEdit is true: ${existing.path}. Ask the user to edit it.`,
    );
  }
  if (
    memories.some(
      (memory) =>
        memory.path !== existing.path &&
        isInside({ path: memory.path, parent: dirname(existing.path) }),
    )
  ) {
    throw new Error(
      `Move nested memories out of ${dirname(existing.path)} before updating it. Cannot rename or edit a memory folder containing other memories.`,
    );
  }

  // Undefined fields from direct callers behave like omitted JSON fields. Null is a real value.
  const fields = Object.fromEntries(
    Object.entries(input.frontmatter ?? {}).filter(([, value]) => value !== undefined),
  );
  const frontmatter = { ...existing.frontmatter, ...fields, id: existing.frontmatter.id };
  if (input.frontmatter?.title !== undefined) {
    frontmatter.title = input.frontmatter.title.trim();
  }
  let project = existing.project;
  // A content-only update must not recompute placement or change implicit scope.
  if (input.frontmatter?.scope !== undefined) {
    const placement = await placeMemory({ repo: workspace.repo, scope: input.frontmatter.scope });
    project = placement.project;
    if (placement.scope === undefined) {
      delete frontmatter.scope;
    } else {
      frontmatter.scope = placement.scope;
    }
  }
  return saveMemory({
    repo: workspace.repo,
    project,
    frontmatter,
    body: input.body === undefined ? existing.body : `${input.body.replace(/\s*$/, "")}\n`,
    existing,
  });
}

/** Registers path-based updates with optional body and frontmatter patches. */
export function registerUpdateCommand({ program }: { program: Command }) {
  program
    .command("update")
    .requiredOption(
      "--roots <path...>",
      "Workspace directories; repeat the flag or provide multiple paths.",
    )
    .requiredOption("--repo <path>", "Git root of the workspace project the agent is working on.")
    .description(
      "Update one existing memory from JSON with a required path and optional body and frontmatter. Omitted fields keep their values; omit id. Every update repairs the title folder if needed. Use the returned path for subsequent calls.",
    )
    .option("--input <file>", "Read one memory JSON object from a file; omit or use - for stdin.")
    .action(async (options: { roots: string[]; repo: string; input?: string }) => {
      const value = await readJsonInput({
        file: options.input,
        label: "update",
        example: '{"path":"/repo/.memories/data/memory-title/memory.md","body":"Updated content"}',
      });
      const input = parseValue({ schema: updateSchema, value, label: "update input" });
      const result = await update({ ...input, roots: options.roots, repo: options.repo });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    });
}
