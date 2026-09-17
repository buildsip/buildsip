import { getAncestors, isInside, relativePosix, statIfExists } from "@buildsip/file-utils";
import { execFile } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { NAMES } from "./names";
import { normalizeScopes } from "./normalize-scopes";

// Adapt Node's callback-based process API so Git commands can be awaited.
const exec = promisify(execFile);
const skip = new Set<string>([NAMES.NODE_MODULES, NAMES.GIT, NAMES.MEMORIES]);

/**
 * Finds repo and package directories that can own memory stores.
 * `project` limits the search to a directory within `repo`; scopes are repo-relative.
 * Directory scopes include child packages, and every scope includes ancestor stores.
 *
 * @returns Candidate store directories. A candidate need not have .memories yet.
 */
export async function findStores({
  repo,
  project,
  scopes = ["*"],
}: {
  repo: string;
  project: string;
  scopes?: string[];
}) {
  const normalizedScopes = normalizeScopes(scopes);
  const globalScope = normalizedScopes.includes("*") || normalizedScopes.includes(".");
  const scopeStarts = new Set(
    globalScope ? [project] : normalizedScopes.map((scope) => resolve(repo, scope)),
  );
  const scopeDirectories: string[] = [];
  for (const scopeStart of scopeStarts) {
    if (!isInside({ path: scopeStart, parent: project })) {
      throw new Error(
        `Choose a scope inside ${project}; ${scopeStart} is outside that search directory.`,
      );
    }
    // Only directory scopes need downward discovery; files use their ancestor stores.
    const info = await statIfExists({ path: scopeStart, ignoreNotDirectory: true });
    if (info?.isDirectory()) scopeDirectories.push(scopeStart);
  }
  // Writing walks up (scope "apps" → repo .memories). Reading also looks down:
  // a memory scoped to apps/web lives in apps/web/.memories, and a search for
  // "apps" still needs that store. Ask Git which package.json files sit under
  // each existing scope directory so we can load those child stores too.
  if (scopeDirectories.length) {
    // Git lists tracked and non-ignored untracked paths without opening their contents.
    // -z separates filenames with NUL, so spaces and newlines in names are safe to split.
    const args = ["-C", repo, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--"];
    for (const scopeDirectory of scopeDirectories) {
      const path = relativePosix({ from: repo, to: scopeDirectory }) || ".";
      // Literal pathspecs keep [id], (auth), and other route names from becoming Git patterns.
      args.push(`:(literal)${path}`);
    }
    const { stdout } = await exec("git", args, { maxBuffer: 64 * 1024 * 1024 });
    for (const file of stdout.split("\0").filter(Boolean)) {
      if (basename(file) !== NAMES.PACKAGE_JSON) continue;
      // Git can still list manifests under these folders; they are never package stores.
      if (file.split("/").some((part) => skip.has(part))) continue;
      scopeStarts.add(dirname(join(repo, file)));
    }
  }
  const stores = new Set<string>();
  for (const scopeStart of scopeStarts) {
    // A matching file can use memories from its package and any parent package up to the repo.
    for (const parent of getAncestors({ path: scopeStart, root: repo })) {
      const manifest = await statIfExists({
        path: join(parent, NAMES.PACKAGE_JSON),
        ignoreNotDirectory: true,
      });
      if (parent === repo || manifest?.isFile()) stores.add(parent);
    }
  }
  return { stores: [...stores].sort() };
}
