import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function findProjectRoot(startDirectory: string) {
  for (let currentDirectory = startDirectory; ; currentDirectory = dirname(currentDirectory)) {
    try {
      await stat(join(currentDirectory, ".git"));
      return currentDirectory;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }

    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      return startDirectory;
    }
  }
}
