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
| `body` | `string` | Yes | Markdown content. |
| `frontmatter` | `object` | Yes | Memory metadata and configured custom fields. See [insert input](../cli/insert.md#input). |

Choose the narrowest [scope](../memory/scope.md) where the memory provides useful context. For example, a login-session cookie rule used throughout authentication belongs to `["apps/web/auth"]`. Use `["*"]` only for context useful across the whole repository.

## Returns

A JSON array containing the absolute path of the new memory directory, followed by a second text block with [categorization guidance and the store's directory listing](./index.md#categorization-guidance). Use the returned path for subsequent calls, or the new path if you move the memory.
