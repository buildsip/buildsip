# update-memory

Patches one memory using [`mem-cli update`](../cli/update.md)'s validation and movement rules.

```json
{
  "roots": ["/workspace/app"],
  "repo": "/workspace/app",
  "path": "/workspace/app/.memories/data/cache",
  "body": "Invalidate cached responses when permissions change."
}
```

## Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| [`roots`, `repo`](./index.md#shared-parameters) | — | Yes | Workspace and active repository. |
| `path` | `string` | Yes | Existing memory directory containing `memory.md`. Relative paths resolve from the server's working directory; prefer a returned absolute path. |
| `body` | `string` | No | Replacement Markdown body. |
| `frontmatter` | `object` | No | Memory metadata and configured custom fields. See [update input](../cli/update.md#input). |

Omitted fields retain their values. A path-only call repairs the title folder. [`doNotEdit`](../memory/doNotEdit.md) blocks updates, including attempts to remove that protection.

## Returns

A JSON array containing the resulting absolute memory directory path. Scope and title changes can move the memory; use the returned path for later calls.
