# mem-cli search

`mem-cli search` ranks memories by title, frontmatter, directory tags, and Markdown body.

```bash filename="Terminal"
mem-cli search --roots /repo --repo /repo --query "axios retry"
```

Stdout is a JSON array. No matches print `[]`.

Returned paths are absolute memory directories and can be passed to [`update`](./update.md) or [`delete`](./delete.md).

```json
[
  {
    "path": "/repo/apps/web/.memories/data/axios-retry-duplication-after-reconnect",
    "score": 3.2,
    "frontmatter": {
      "id": "11111111-1111-4111-8111-111111111111",
      "title": "Axios retry duplication after reconnect"
    },
    "body": "Retry the client once after a reconnect; do not stack interceptors.\n"
  }
]
```

## Reference

| Options | Description |
| --- | --- |
| [`--roots <path...>`](./index.md#--roots) | Workspace directories. Required. |
| [`--repo <path>`](./index.md#--repo) | Git root. Required. |
| `--query <text>` | Nonempty search string. Required. |
| `--scope <path...>` | Repository-relative file or directory paths. Default `*` (the whole repo). |
| `--limit <number>` | Maximum number of ranked hits. Default `50`. Must be a positive integer. |
| `--offset <number>` | Ranked hits to skip. Default `0`. Must be a nonnegative integer. |

`--query` of only whitespace is rejected.

### Ranking

Title matches outrank directory-tag matches, which outrank frontmatter and body. Directory tags are the path from the owning package (or repo) to `memory.md`, so folders such as `errors/` are searchable.

The in-process index rebuilds when selected files or their filesystem metadata change.

### Scope

`--scope` uses the same path rules as [`scope`](../memory/scope.md). It selects stores in `--repo` and keeps memories that apply to those paths. Matching is bidirectional: searching a folder also finds memories scoped to files under it, and searching a file finds memories scoped to an ancestor folder.

`*`, `.`, or a list that includes either one searches the whole repo.

Directory scopes include child packages. Ancestor stores up to the repo root are included.

Malformed memories in selected stores fail the search. Sibling stores outside the scope are not read.

### Workspace

`--roots` other than `--repo` contribute stores only when that other Git root sets [`availableToWorkspace`](../config/availableToWorkspace.md) to `true`. Local `--scope` does not filter those memories.

Overlapping workspace folders are deduplicated by `memory.md` path.

Search validates each store's config and built-in memory fields. Custom fields remain searchable after [schema changes](../config/frontmatter.md#schema-changes).

## Examples

### Paginate

```bash filename="Terminal"
mem-cli search --roots /repo --repo /repo --query cache --limit 1 --offset 1
```

### Limit to a tree

```bash filename="Terminal"
mem-cli search --roots /repo --repo /repo --query cache --scope apps/web
```

### Several areas

```bash filename="Terminal"
mem-cli search --roots /repo --repo /repo --query cache --scope apps/web --scope apps/api
```

Hits are unioned, not duplicated.

### Shared workspace repo

```bash filename="Terminal"
mem-cli search --roots /repo --roots /team --repo /repo --query cache --scope apps/web
```

## Related

- [`scope`](../memory/scope.md)
- [`availableToWorkspace`](../config/availableToWorkspace.md)
- [`data/`](../file-conventions/data.md)
