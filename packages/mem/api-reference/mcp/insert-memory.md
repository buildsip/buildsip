# insert-memory

Creates one memory using [`mem-cli insert`](../cli/insert.md)'s validation and placement rules. Search for a related memory before inserting; update it if it already covers the subject.

```json
{
  "roots": ["/workspace/app"],
  "repo": "/workspace/app",
  "body": "Cache responses only after authentication succeeds.",
  "frontmatter": {
    "title": "Authenticated response caching",
    "scope": ["apps/web/auth"]
  }
}
```

## Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| [`roots`, `repo`](./index.md#shared-parameters) | — | Yes | Workspace and active repository. |
| `body` | `string` | Yes | Nonempty Markdown content. |
| `frontmatter` | `object` | Yes | Metadata with a nonempty `title` and `scope` array. Optional protection flags and configured custom fields are accepted. Omit `id`. |

Use the narrowest existing repository-relative scope that covers the memory. Use `["*"]` only for repository-wide memories. See [scope](../memory/scope.md).

## Returns

A JSON array containing the absolute path of the new `memory.md`. Use this path for subsequent calls.
