import { stat } from "node:fs/promises";

/**
 * Reads metadata, following symbolic links. Missing paths return undefined.
 *
 * Set `ignoreNotDirectory` to return undefined for paths such as
 * `index.ts/package.json`, where an existing file cannot contain the requested entry.
 * Permission errors and other failures still throw.
 */
export async function statIfExists({
  path,
  ignoreNotDirectory = false,
}: {
  path: string;
  ignoreNotDirectory?: boolean;
}) {
  try {
    return await stat(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      // /repo/apps/web/src/auth.ts/package.json — not a thing → ENOENT
      // /repo/apps/web/src/package.json — no file → ENOENT
      code === "ENOENT" ||
      // path = /repo/apps/web/src/auth.ts/package.json → ENOTDIR
      (ignoreNotDirectory && code === "ENOTDIR")
    ) {
      return undefined;
    }
    throw error;
  }
}
