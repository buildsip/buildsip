import { readTextIfExistsSync } from "@buildsip/file-utils";
import { randomUUID } from "node:crypto";
import { linkSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NAMES } from "./names";

/**
 * Stages complete settings text beside its destination, then publishes it.
 * `previous` is the text read before prompting, or undefined for a new file.
 * Rejects changes detected since that read; the check and replacement are separate
 * operations, so this is not a lock against concurrent writers.
 */
export function writeText({
  path,
  text,
  previous,
}: {
  path: string;
  text: string;
  previous?: string;
}) {
  // Write to a unique temporary file first, so a failed write leaves the destination intact.
  // Keep it beside the destination: hard links require the same filesystem, as does an atomic rename.
  const temp = join(dirname(path), `${NAMES.MEM_PREFIX}${randomUUID()}.tmp`);
  try {
    // wx creates a new file exclusively; it fails instead of overwriting an existing file.
    writeFileSync(temp, text, { flag: "wx" });
    const current = readTextIfExistsSync(path);
    if (current !== previous) {
      throw new Error(`Settings changed during initialization. Run init again: ${path}`);
    }
    // New files are linked exclusively; existing files are replaced only after a complete write.
    // A hard link publishes the finished file under its final name and fails if that name exists.
    if (previous === undefined) linkSync(temp, path);
    else renameSync(temp, path);
  } finally {
    // Removing the temporary name leaves the published file intact; rename may have removed it already.
    rmSync(temp, { force: true });
  }
}
