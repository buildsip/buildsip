# MCP Tools

### `insert-memory`

Creates one memory.

Memories go into the deepest package or repo root containing every scoped path.

Example: `scope: ["apps/web/auth", "apps/web/constants.ts"]` => memory is created in `apps/web/.memories`

For a memory at the Git root, pass `["*"]`.

### `update-memory`

Updates an existing memory.

Changing scope can move the memory to another package or the repo root. Every update also repairs the memory folder's name to match the title, even if the title did not change.

Updates respect `doNotEdit` and refuse to overwrite another folder or move a folder containing other memories.

### `get-recent-sessions`

Fetches the recent sessions across agent harnesses. Useful when context for the memory lives in other conversations. Strips down a chat log to user messages, final assistant turn messages, roles (user, agent) and timestamps.

### `search-memories`

Searches the memories.

Params:

- `scope`: Optional array of repository-relative file or directory paths. If omitted or `["*"]`/`["."]`, it searches the whole repo.

Search reads memories from:

- descendant `.memories` directories
- all parents' `.memories` directories up to the repo root whose scope includes or overlaps with the requested `scope` param
- other repositories in the workspace with `[availableToWorkspace: true](./config.md#availabletoworkspace)`

Examples:

- `apps/web` searches memories from:
  - `apps/web/.memories`
  - root `.memories`, only includes memories whose frontmatter `scope` includes or overlaps with `apps/web`, e.g. `apps`, `apps/web/auth`
  - other workspace repos where `availableToWorkspace` is set to `true`

**Good to know**: Upvotes or recency don't affect results.

#### Reporting stale memories

After the search, the agent will inspect some of the memories to execute its original task. The `search-memories` tool also instructs the agent to report and offer to delete stale memories if found, e.g. memories that contradict the code.

#### Why doesn't mem-cli use vector search or reranking?

mem-cli doesn't store every session. It stores short, selected memories that are meant to remain useful over time.

Search is also narrowed by scope, so an agent working in one package doesn't have to search memories from unrelated parts of the repo.

That keeps the search space small. BM25 is enough without adding embeddings, vector databases, or reranking.

More advanced search becomes useful when a system stores much larger amounts of noisy data, such as full session history. mem-cli avoids creating that problem in the first place.

### `prune-memories`

Returns memories older than `minimumAge`. This tool itself doesn't prune the memories, only returns candidates for pruning.

### `upvote-memories`

When a memory is used to produce a reply, the AI upvotes. You may also ask the AI to upvote a memory, in which case the log will record the `actor` is a human.

### `delete-memories`

Deletes memories. Respects `doNotDelete`.
