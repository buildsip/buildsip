import { readFileSync } from "node:fs";

/**
 * Synchronously reads UTF-8 text, returning undefined only for ENOENT.
 */
export function readTextIfExistsSync(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
