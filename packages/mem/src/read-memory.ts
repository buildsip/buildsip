import { assertNoSymlinks } from "@buildsip/file-utils";
import { readFile, stat } from "node:fs/promises";
import { parseDocument } from "yaml";
import { storedFrontmatterSchema } from "./stored-frontmatter-schema";
import { parseValue } from "./parse-value";
import type { Memory } from "./memory";

const cache = new Map<string, { stamp: string; frontmatter: unknown; body: string }>();

/**
 * Reads YAML frontmatter and the Markdown body, reusing parsed content while the
 * file's timestamps, size, and inode stay unchanged. Reads check built-in fields;
 * custom schemas apply only when saving, so schema changes do not hide old memories.
 */
export async function readMemory({
  path,
  project,
  repo,
}: {
  path: string;
  project: string;
  repo: string;
}): Promise<Memory> {
  await assertNoSymlinks({ path, base: repo });
  // Nanosecond timestamps catch quick edits; the inode changes when a file is replaced.
  const info = await stat(path, { bigint: true });
  const stamp = `${info.mtimeNs}:${info.ctimeNs}:${info.size}:${info.ino}`;
  let parsed = cache.get(path);
  if (parsed?.stamp !== stamp) {
    const source = await readFile(path, "utf8");
    // Parse only the delimited header; Markdown bodies never go through the YAML parser.
    const match = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
    if (!match) throw new Error(`Missing YAML frontmatter: ${path}`);
    const document = parseDocument(match[1]!, { uniqueKeys: true });
    if (document.errors.length)
      throw new Error(`Invalid YAML ${path}: ${document.errors[0]!.message}`);
    parsed = {
      stamp,
      frontmatter: document.toJS({ maxAliasCount: 0 }),
      body: source.slice(match[0].length).replace(/^\r?\n/, ""),
    };
    if (cache.size >= 5000) cache.clear();
    cache.set(path, parsed);
  }
  const frontmatter = parseValue({
    schema: storedFrontmatterSchema,
    value: parsed.frontmatter,
    label: `frontmatter ${path}`,
    path: ["frontmatter"],
  });
  return { path, project, stamp, frontmatter, body: parsed.body };
}
