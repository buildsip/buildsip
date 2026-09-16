# Implementation plan

- `npx mem-cli init` runs `npx add-mcp mem-cli` to install the MCP. Should offer option: install to all available agents or just to selected agents.
- MCP tools take a required `roots` argument: absolute paths to every workspace folder, not only the active repo. Pass `roots` through to the CLI. Support for exposing the current workspace or project path to MCP servers is inconsistent across the ecosystem (env vars, config interpolation, MCP `roots`, or nothing at all).
- Memories MCP tools (NOT `get-recent-sessions`) also take a `targetProject` param.
- `upsert-memories` tool should return a list of paths to the memories.
- The description of `upsert-memories` should instruct the model to first call `search-memories` to make sure a duplicate/related memory that could be edited doesn't exist.
- Memory directories should be named according to the title, e.g. `sentry-error/` where the title is "Sentry error"
- When a memory is updated => should double down as an upvote (meaning record it inside the tool as an upvote).
- `get-recent-sessions`: works the same as buildsip CLI's `prepare` command.
- `prune-memories`: Upvotes don't stack. Upvote on day 0 (human) → lives until day 180 (when `ttl` = 180). Upvote again on day 120 → lives until day 300 (when `humanUpvoteAdds` = 180).
- The generated `.memories` directory should also contain:
- `config.json` should also contain a `version` field.
- `npx mem-cli init` should ask the user if they enabled pruning or not and install stuff accordingly.
- `npx mem-cli init` should also ask the user if they want to do this:

Every memory file is named `memory.md`, so VS Code and Cursor tabs all look identical. To fix this, update `.vscode/settings.json`:

```json
{
  "workbench.editor.customLabels.patterns": {
    "**/.memories/**/memory.md": "${dirname}/memory.md"
  }
}
```

## How search works

MiniSearch in memory, rebuilt from the markdown files. Reuse the in-process index if file mtimes are unchanged since the last build.

1. Don't use heavy YAML parsers for everything: Libraries like `gray-matter` or `js-yaml` are slow when parsing 5,000 files. Use a simple, fast regex to extract frontmatter before passing it to a lightweight parser.
2. Batch `fs.readFile` calls: Don't use `Promise.all(files.map(readFile))` on 10,000 files (you will hit Node's EMFILE: too many open files error). Use a concurrency limiter (like `p-limit` set to 50–100 concurrent reads).

Params for `search-memories`:

- `targetProject`
- `roots` - required. Absolute paths to every workspace folder.
- `scope`: an array of paths, wildcards allowed; optional.
- `query`

# Planned for v2

- Use `mem-cli doctor --fix` to:
  - find and fix broken file references or ids
  - check `memory.md` parent folders are named the same as the memory title
- Zod
- Hosted upvote ledger (mem-cli cloud): a GitHub **fork** of a repo that uses the hosted DB can get a copy of that ledger. A `git clone` cannot — there is no identity or webhook. People working on the **same** repo share one database; they do not each get a clone of it.

Let the user alternatively use [Zod](https://zod.dev/) to generate the schema.

`config.json`:

```ts
{
  "schema": "./schema.ts" // path to schema
}
```

`.memories/schema.ts`:

```ts
import { z } from "zod";

export default z
  .object({
    anchors: z.array(z.string()),
    linear: z.string().url().optional(),
  })
  .strict();
```

- Wait for clients to expose workspace roots reliably instead of receiving roots as a tool argument.

# We're not doing this

- Writing telemetry / upvotes into Git (`last_used`, `human_last_upvoted`, `ai_last_upvoted` in frontmatter, a JSON sidecar, weekly PRs, or a side branch).
  - _Why:_ GitHub has no way to update a cloned file without a commit. Batching those writes into a weekly PR still smears a lease cache onto the knowledge repo, and Git does not have native support for this. If the product succeeds, Git/GitHub can grow a real store; do not fake one in v1.
  - _What to do instead:_ Keep upvote events in PostgreSQL (optional). Markdown in git is the memory. No DB means no upvote-based prune — janitor grep still works. A clone of an OSS repo gets the markdown, not the lease ledger.

- Git Notes (`git notes`) for telemetry.
  - _Why:_ Too hacky. Git notes attach to Object/Blob SHAs, not file paths. Editing or deleting a file creates a new blob SHA, immediately orphaning the note unless complex migration scripts run on every commit.

- Making PostgreSQL mandatory.
  - _Why:_ Breaks zero-config local development and locks out open-source contributors without DB credentials. Postgres should remain an optional opt-in.

- Native SQLite binaries (`better-sqlite3`).
  - _Why:_ Native C++ compilation (`node-gyp`) breaks across OSes, Docker/Alpine containers, and Node version upgrades.
  - _What to do instead:_ Pure JavaScript in-memory search (**`MiniSearch`**), rebuilt from the markdown files. Zero native dependencies.

- Global recursive downward globbing (`**/.memories/**`).
  - _Why:_ In large monorepos or cloud virtual filesystems (Google CitC, Meta EdenFS), a downward glob triggers thousands of remote downloads and freezes the IDE.
  - _What to do instead:_ **Upward traversal** (start at the active file's package, walk up ancestor folders to `.git`, ignore sibling trees) + `availableToWorkspace` behavior.

- Decided AGAINST: Arbitrary `.memories/` placement (e.g. inside `src/`).
  - _Why:_ Pollutes source code and triggers dev-server/bundler hot reloads (Vite, Next.js / Turbopack HMR) whenever a memory is edited.
  - _What to do instead:_ Restricted strictly to **package roots** and the **repo root**.

- `.memories/archive/`, `includeArchive`, or an `archive-memories` tool.
  - _Why:_ Git is the archive.

- Auto-delete after X days of no upvotes.
  - _Why:_ Engineering decisions decay with code changes, not calendar days.
  - _What to do instead:_ **AI Janitor PRs**. When running prune, an agent checks if the memory is still relevant, then returns a suggested list of candidates to remove.

- Dynamic TypeScript schema evaluation (`schema.ts` in v1).
  - _Why:_ Running arbitrary `.ts` files inside background MCP servers introduces Remote Code Execution (RCE) risks when opening untrusted cloned repos.
  - _What to do instead:_ Standard declarative **JSON Schema** in `config.json` for v1. Deferred Zod runtime execution to v2.

- Clone shared memory repos inside a `.gitignore`'d directory at the project root to avoid multi-root workspaces.
  - _Why_: Breaks immediately when a workspace contains multiple monorepos (a very common setup). Each monorepo ends up with its own duplicate clone of the org/team memory repo, causing duplication, sync drift across local folders, and wasted maintenance.

- Consumer repos declare dependencies via paths (e.g., `extends: ["../org-memories"]` in `config.json`).
  - _Why_: Machine-dependent paths get committed to Git, breaking immediately across different team members' machines, folder layouts, and operating systems.
- Using a persistent or open Pull Request as a live telemetry database ("Living Upvotes PR")
  - _Why:_ Pushing live commits via the GitHub API to an open PR whenever an upvote occurs triggers GitHub Actions workflows (`on: pull_request`) on every turn, rapidly exhausting monthly CI compute minutes. It creates notification spam for repo watchers, hits GitHub's secondary API rate limits, causes HTTP 409 SHA-conflict errors during concurrent agent turns, and fails for forks (which do not inherit PRs).

- Committing upvotes directly to a dedicated remote Git branch via GitHub API
  - _Why:_ Open-source fork contributors do not have push permissions to upstream repositories (`403 Forbidden`). Concurrent tool calls cause git ref race conditions, tools fail when running offline, and high-frequency commits bloat the Git object database with thousands of tiny telemetry objects.

- Strictly requiring `scope` in `search-memories` or blocking directory globs
  - _Why:_ For broad architectural questions or cross-package build errors, requiring an exact file forces agents into artificial guessing or running 5+ sequential package searches in a loop. Allowing `scope` to be optional (defaulting to `*`) and supporting wildcards like `apps/*` maximizes retrieval flexibility while maintaining isolation when working on specific files.
