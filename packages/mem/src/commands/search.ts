import { relativePosix } from "@buildsip/file-utils";
import type { Command } from "commander";
import { dirname, relative } from "node:path";
import MiniSearch from "minisearch";
import { findRepo } from "../find-repo";
import { findStores } from "../find-stores";
import { loadMemories } from "../load-memories";
import { matchesScope } from "../matches-scope";
import { normalizeScopes } from "../normalize-scopes";
import { resolveRepo } from "../resolve-repo";
import { validateScopes } from "../validate-scopes";
import type { Memory } from "../memory";

let cached: { stamp: string; index: MiniSearch } | undefined;

/**
 * Searches the selected repo plus memories from other workspace repos that
 * set availableToWorkspace.
 * Local scopes filter which memories apply; results are ranked before pagination.
 *
 * @returns Memory directory paths, scores, frontmatter, and bodies for the requested page.
 */
export async function search({
  roots,
  repo,
  query,
  scope = ["*"],
  limit = 50,
  offset = 0,
}: {
  roots: string[];
  repo: string;
  query: string;
  scope?: string[];
  limit?: number;
  offset?: number;
}) {
  if (!query.trim()) throw new Error("query must not be empty.");
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(offset) || offset < 0)
    throw new Error("limit must be a positive integer and offset a nonnegative integer.");
  const workspace = await resolveRepo({ roots, repo });
  const scopes = await validateScopes({ repo: workspace.repo, scope });
  const { stores } = await findStores({
    repo: workspace.repo,
    project: workspace.repo,
    scopes,
  });
  const local = await loadMemories({ stores, repo: workspace.repo });
  const memories: Memory[] = local.filter((memory) => {
    if (scopes.some((value) => ["*", "."].includes(value))) return true;
    // Without an explicit scope, a memory applies to its owning package (or . for the repo).
    const owner = relativePosix({ from: workspace.repo, to: memory.project }) || ".";
    const appliesTo = normalizeScopes(memory.frontmatter.scope ?? [owner]);
    // Check both directions: searching a folder should also find memories scoped to its files.
    return scopes.some((path) =>
      appliesTo.some(
        (scope) => matchesScope({ scope, path }) || matchesScope({ scope: path, path: scope }),
      ),
    );
  });
  // Other repos contribute only stores with availableToWorkspace; local scopes do not filter those memories.
  for (const root of workspace.roots) {
    const other = await findRepo(root).catch(() => undefined);
    if (!other || other === workspace.repo) continue;
    const { stores } = await findStores({ repo: other, project: root });
    memories.push(...(await loadMemories({ stores, repo: other, availableToWorkspaceOnly: true })));
  }
  // Overlapping workspace folders can discover the same memory more than once.
  const unique = [...new Map(memories.map((memory) => [memory.path, memory])).values()].sort(
    (a, b) => a.path.localeCompare(b.path),
  );
  // Rebuild the index when the selected files or their filesystem metadata change.
  const stamp = JSON.stringify(unique.map((memory) => [memory.path, memory.stamp]));
  if (cached?.stamp !== stamp) {
    const index = new MiniSearch({
      idField: "path",
      fields: ["title", "tags", "frontmatter", "body"],
      searchOptions: { boost: { title: 3, tags: 2 } },
    });
    index.addAll(
      unique.map((memory) => ({
        path: memory.path,
        title: memory.frontmatter.title,
        tags: relative(memory.project, memory.path),
        frontmatter: JSON.stringify(memory.frontmatter),
        body: memory.body,
      })),
    );
    cached = { stamp, index };
  }
  const byPath = new Map(unique.map((memory) => [memory.path, memory]));
  return cached.index
    .search(query)
    .slice(offset, offset + limit)
    .map(({ id, score }) => {
      const memory = byPath.get(String(id))!;
      return {
        path: dirname(memory.path),
        score,
        frontmatter: memory.frontmatter,
        body: memory.body,
      };
    });
}

export function registerSearchCommand({ program }: { program: Command }) {
  program
    .command("search")
    .requiredOption(
      "--roots <path...>",
      "Workspace directories; repeat the flag or provide multiple paths.",
    )
    .requiredOption("--repo <path>", "Git root of the workspace project the agent is working on.")
    .description("Search memory titles, frontmatter, directory tags, and Markdown bodies.")
    .requiredOption("--query <text>", "Nonempty search query.")
    .option(
      "--scope <path...>",
      "Existing repository-relative file or directory paths; directories include child packages. Defaults to * (the whole repo).",
    )
    .option("--limit <number>", "Maximum number of results.", "50")
    .option("--offset <number>", "Number of ranked results to skip.", "0")
    .action(
      async (options: {
        roots: string[];
        repo: string;
        query: string;
        scope?: string[];
        limit: string;
        offset: string;
      }) => {
        const result = await search({
          ...options,
          limit: Number(options.limit),
          offset: Number(options.offset),
        });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      },
    );
}
