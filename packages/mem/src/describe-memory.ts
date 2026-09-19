import { getAncestors, relativePosix } from "@buildsip/file-utils";
import { readdir, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { NAMES } from "./names";

/** Adds attachment and categorization guidance after a successful write, using the saved location. */
export async function describeMemory({ path, repo }: { path: string; repo: string }) {
  const saved = `Memory saved at ${JSON.stringify(path)}.
You may now add attachments beside ${NAMES.MEMORY_MD} in this directory when useful. Attachments are supporting files, such as images or long documents, and are not searchable.`;
  let data: string | undefined;
  try {
    // Start at the repo so a category named .memories/data cannot replace the store boundary.
    // Resolve aliases such as /tmp before comparing with the command's canonical saved path.
    data = getAncestors({ path, root: await realpath(repo) })
      .reverse()
      // A store's .memories/data is at least two levels below the repo, whatever its name.
      .slice(2)
      .find((dir) => basename(dir) === NAMES.DATA && basename(dirname(dir)) === NAMES.MEMORIES);
  } catch {
    // The write already succeeded; optional guidance must never report it as a failed write.
  }
  if (!data) {
    return `${saved} Search again to confirm its owning ${NAMES.MEMORIES}/${NAMES.DATA} directory before categorizing it; never move it outside that directory.`;
  }

  const instructions = `${saved}
The parent directories of a memory directory within ${NAMES.DATA} directories act as tags when searching memories. You may create new parent directories (multiple levels allowed). Choose clear, human-readable names that help the user browse and understand their memories.
You may move this memory directory anywhere within ${JSON.stringify(data)}, or leave it where it is. Never move it outside this exact ${NAMES.DATA} directory or into another ${NAMES.MEMORIES} directory.`;

  try {
    const dirs = [data];
    const categories: string[] = [];
    // Read directory entries only. Never open memory bodies or descend into attachment folders.
    for (const dir of dirs) {
      const entries = await readdir(dir, { withFileTypes: true });
      if (dir !== data && entries.some((entry) => entry.name === NAMES.MEMORY_MD)) continue;
      const relative = relativePosix({ from: data, to: dir });
      categories.push(`${NAMES.DATA}/${relative ? `${relative}/` : ""}`);
      for (const entry of entries) {
        // isDirectory excludes symbolic links; temporary write stages are not categories.
        if (entry.isDirectory() && !entry.name.startsWith(NAMES.MEM_PREFIX)) {
          dirs.push(join(dir, entry.name));
        }
      }
    }
    // One relative path per line is the same structure as a filtered `find` listing.
    return `${instructions}\n\n${JSON.stringify(data)} looks like this:\n${categories.sort().join("\n")}`;
  } catch {
    return `${instructions}\n\nThe ${NAMES.DATA} directory listing could not be read. Inspect ${JSON.stringify(data)} before choosing a destination; the memory was saved successfully.`;
  }
}
