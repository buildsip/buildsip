import { assertNoSymlinks, lstatIfExists } from "@buildsip/file-utils";
import { randomUUID } from "node:crypto";
import { mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { stringify } from "yaml";
import type { Memory } from "./memory";
import { NAMES } from "./names";
import { readConfig } from "./read-config";
import { validateFrontmatter, type Frontmatter } from "./validate-frontmatter";

/**
 * Validates the complete memory, then publishes it in its title-named folder.
 * Existing folders move with their attachments; failed writes undo that move.
 * Body formatting is prepared by the caller so omitted update bodies stay unchanged.
 */
export async function saveMemory({
  repo,
  project,
  frontmatter,
  body,
  existing,
}: {
  repo: string;
  project: string;
  frontmatter: Frontmatter;
  body: string;
  existing?: Memory;
}) {
  const { config } = await readConfig({ project, repo });
  validateFrontmatter({ value: frontmatter, config, path: project });
  // Split accents from letters, then turn punctuation and spaces into folder-safe hyphens.
  const slug = frontmatter.title
    .trim()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
  if (!slug || Buffer.byteLength(slug) > 200)
    throw new Error(
      "Choose a title that produces a folder name of 1–200 bytes, containing letters or numbers.",
    );
  const data = join(project, NAMES.MEMORIES, NAMES.DATA);
  const oldData = existing && join(existing.project, NAMES.MEMORIES, NAMES.DATA);
  if (existing && dirname(existing.path) === oldData) {
    // .memories/data/memory.md
    throw new Error(
      `${NAMES.MEMORY_MD} can't be a direct child of ${NAMES.DATA}. Move it into its own directory inside ${NAMES.DATA} before updating it.`,
    );
  }
  // Keep tags such as errors/cache when moving between stores or renaming the title folder.
  const tags = existing ? relative(oldData!, dirname(dirname(existing.path))) : "";
  const parent = join(data, tags);
  const folder = join(parent, slug);
  const path = join(folder, NAMES.MEMORY_MD);
  await assertNoSymlinks({ path, base: repo });
  const destination = await lstatIfExists({ path: folder });
  // On case-insensitive disks, CACHE and cache can be the same directory.
  // Allow repairing its spelling, while refusing a genuinely different destination.
  if (destination && (!existing || (await realpath(folder)) !== dirname(existing.path))) {
    throw new Error(
      `A memory folder already exists: ${folder}. Use update with this directory path to edit that memory, or choose another title.`,
    );
  }
  await mkdir(parent, { recursive: true });
  // Finish writing beside the destination before replacing the visible memory file by rename.
  const stage = join(parent, `${NAMES.MEM_PREFIX}${randomUUID()}`);
  await mkdir(stage);
  let moved = false;
  let created = false;
  try {
    await writeFile(join(stage, NAMES.MEMORY_MD), `---\n${stringify(frontmatter)}---\n\n${body}`, {
      flag: "wx",
    });
    if (existing) {
      // Move the entire folder so attachments stay with the memory when its title or scope changes.
      if (path !== existing.path) {
        await rename(dirname(existing.path), folder);
        moved = true;
      }
      await rename(join(stage, NAMES.MEMORY_MD), path);
    } else {
      // Reserve the destination exclusively so a concurrent insert cannot be overwritten.
      await mkdir(folder);
      created = true;
      await rename(join(stage, NAMES.MEMORY_MD), path);
    }
  } catch (error) {
    // If publishing failed, undo only the folder move or creation made by this attempt.
    if (moved && existing) await rename(folder, dirname(existing.path));
    if (created) await rm(folder, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  return [folder];
}
