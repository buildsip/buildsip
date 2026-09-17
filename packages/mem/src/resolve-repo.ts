import { isInside } from "@buildsip/file-utils";
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { findRepo } from "./find-repo";

type Workspace = {
  roots: string[];
  repo: string;
};

/**
 * Canonicalizes workspace folders and the Git root the agent is working on.
 *
 * @param roots - Paths to workspace projects
 * @param repo - Path to repo
 *
 * @returns Canonicalized paths
 */
export async function resolveRepo({
  roots,
  repo,
}: {
  roots: string[];
  repo: string;
}): Promise<Workspace> {
  if (!roots.length || !repo.trim()) {
    throw new Error("roots and repo are required.");
  }
  const folders = await Promise.all(
    [...new Set(roots)].map(async (root) => {
      // resolve makes the path absolute; realpath follows links to its actual location.
      const path = await realpath(resolve(root));
      if (!(await stat(path)).isDirectory())
        throw new Error(`Workspace root must be a directory: ${root}`);
      return path;
    }),
  );
  const path = await realpath(resolve(repo));
  if (!folders.some((root) => isInside({ path, parent: root })))
    throw new Error("repo must be inside one of the workspace roots.");
  if (!(await stat(path)).isDirectory()) throw new Error("repo must be a directory.");
  if (path !== (await findRepo(path))) {
    throw new Error("repo must be the Git root of a workspace project.");
  }
  return { roots: [...new Set(folders)], repo: path };
}
