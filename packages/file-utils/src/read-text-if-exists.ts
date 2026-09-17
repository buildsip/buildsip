import { readFile } from "node:fs/promises";

/** Reads UTF-8 text, returning undefined only for ENOENT. Empty files return "". */
export async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
