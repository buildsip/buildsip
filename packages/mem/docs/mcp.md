# MCP Tools

The MCP gives your agent four ways to work with memories.

### `insert-memory`

Creates one memory.

Memories go into the deepest package or repo root containing every scoped path.

Memories about one package live with that package; repository-wide memories live at the Git root.

### `update-memory`

Updates an existing memory.

Changing scope can move the memory to another package or the repo root. Every update also repairs the memory folder's name to match the title, even if the title did not change.

Updates respect `doNotEdit` and refuse to overwrite another folder or move a folder containing other memories.

### `search-memories`

Searches the memories.

The agent can focus on one part of the repository or search the whole project.

Search reads memories from:

- descendant `.memories` directories
- all parents' `.memories` directories up to the repo root whose scope includes or overlaps with the requested `scope` param
- other repositories in the workspace with [`availableToWorkspace`](./config.md#availabletoworkspace) enabled

Examples:

- `apps/web` searches memories from:
  - `apps/web/.memories`
  - root `.memories`, only includes memories whose frontmatter `scope` includes or overlaps with `apps/web`, e.g. `apps`, `apps/web/auth`
  - other workspace repos where `availableToWorkspace` is set to `true`

**Good to know**: Upvotes or recency don't affect results.

#### Why doesn't mem-cli use vector search or reranking?

mem-cli doesn't store every session. It stores short, selected memories that are meant to remain useful over time.

Search is also narrowed by scope, so an agent working in one package doesn't have to search memories from unrelated parts of the repo.

That keeps the search space small. BM25 is enough without adding embeddings, vector databases, or reranking.

More advanced search becomes useful when a system stores much larger amounts of noisy data, such as full session history. mem-cli avoids creating that problem in the first place.

### `delete-memories`

Deletes memories. Respects `doNotDelete`.
