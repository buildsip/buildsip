# MCP Tools

### `upsert-memories`

Inserts or updates memories.

### `get-recent-sessions`

Fetches the recent sessions across agent harnesses. Useful when context for the memory lives in other conversations. Strips down a chat log to user messages, final assistant turn messages, roles (user, agent) and timestamps.

### `search-memories`

Searches the memories.

Params:

- `scope`: Optional. Globs allowed. Defaults to `*`.

Search has two modes:

- **Specific** `scope` (e.g. `apps/web`, `apps/web/`, `apps/web/components/badge.tsx`): start at that path and walk **up** to the repository root. Sibling trees are skipped. Memories from other repositories in the workspace with `[availableToWorkspace: true](./config.md#availabletoworkspace)` are also included.
- **Omitted** `scope` **or** `scope: "*"` **(global search):** Searches across **all** memories in the `targetProject`.

The parent of the `.memories` directory is already included in `scope`.

Examples:

- `apps/web`:
  - searches `apps/web/.memories` + root `.memories`. Includes memories whose frontmatter `scope` is missing, `*`, or matches `apps/web`.
  - searches all memories from other workspace repos where `availableToWorkspace` is set to `true`
- `*` **or omitted:**
  - searches all memories from the `targetProject`
  - searches all memories from other workspace repos where `availableToWorkspace` is set to `true`

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
