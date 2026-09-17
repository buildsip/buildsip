import { findUp, isInside, relativePosix, statIfExists } from "@buildsip/file-utils";
import { join, resolve } from "node:path";
import { matchesScope } from "./matches-scope";
import { NAMES } from "./names";
import { validateScopes } from "./validate-scopes";

/** Chooses the deepest store containing all scopes and omits scope when the store implies it. */
export async function placeMemory({ repo, scope }: { repo: string; scope: string[] }) {
  const normalizedScopes = await validateScopes({ repo, scope });
  const scopePaths = normalizedScopes.map((scopePath) =>
    scopePath === "*" ? repo : resolve(repo, scopePath),
  );
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
