import {
  assertNoSymlinks,
  findUp,
  isInside,
  relativePosix,
  statIfExists,
} from "@buildsip/file-utils";
import { join, resolve } from "node:path";
import { findRepo } from "./find-repo";
import { matchesScope } from "./matches-scope";
import { NAMES } from "./names";
import { normalizeScopes } from "./normalize-scopes";

/** Chooses the deepest store containing all scopes and omits scope when the store implies it. */
export async function placeMemory({ repo, scope }: { repo: string; scope: string[] }) {
  const normalizedScopes = normalizeScopes(scope).map((scopePath) =>
    scopePath === "." ? "*" : scopePath,
  );
  const scopePaths = normalizedScopes.map((scopePath) =>
    scopePath === "*" ? repo : resolve(repo, scopePath),
  );
  for (const scopePath of scopePaths) {
    // Check the full path before following ancestors, including scopes for files not created yet.
    await assertNoSymlinks({ path: scopePath, base: repo });
    const directory = await findUp({
      path: scopePath,
      root: repo,
      test: async (parent) =>
        (await statIfExists({ path: parent, ignoreNotDirectory: true }))?.isDirectory() === true,
    });
    // The closest existing directory reveals whether this scope crosses into a nested Git repo.
    if (directory && (await findRepo(directory)) !== repo)
      throw new Error(
        `Choose scopes inside ${repo}. Scope ${scopePath} belongs to a different Git repository.`,
      );
  }
  const store =
    (await findUp({
      path: scopePaths[0]!,
      root: repo,
      test: async (parent) => {
        // Find the nearest package that contains every scope, falling back to the repo below.
        if (!scopePaths.every((scopePath) => isInside({ path: scopePath, parent }))) return false;
        const manifest = await statIfExists({
          path: join(parent, NAMES.PACKAGE_JSON),
          ignoreNotDirectory: true,
        });
        return manifest?.isFile() === true;
      },
    })) ?? repo;
  // A parent scope already covers its children; keep only the broadest supplied paths.
  const scopes = [...new Set(normalizedScopes)].filter(
    (scopePath) =>
      !normalizedScopes.some(
        (other) => other !== scopePath && matchesScope({ scope: other, path: scopePath }),
      ),
  );

  const owner = relativePosix({ from: repo, to: store }) || "*";
  return { project: store, scope: scopes.includes(owner) ? undefined : scopes };
}
