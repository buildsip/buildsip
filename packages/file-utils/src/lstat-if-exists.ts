import { lstat } from "node:fs/promises";

/**
 * Reads metadata for the entry itself, including dangling symbolic links.
 * Missing entries return undefined. Set `ignoreNotDirectory` to also return
 * undefined for paths such as `index.ts/package.json`, where an ancestor is a file.
 * Permission errors and other failures still throw.
 */
export async function lstatIfExists({
  path,
  ignoreNotDirectory = false,
}: {
  path: string;
  ignoreNotDirectory?: boolean;
}) {
  try {
    return await lstat(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || (ignoreNotDirectory && code === "ENOTDIR")) return undefined;
    throw error;
  }
}
