import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export async function findGitProjectRoot(startDirectory: string) {
  for (
    let currentDirectory = resolve(startDirectory);
    ;
    currentDirectory = dirname(currentDirectory)
  ) {
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
      return null;
    }
  }
}

export async function findProjectRoot(startDirectory: string) {
  return (await findGitProjectRoot(startDirectory)) ?? resolve(startDirectory);
}
