# delete-memories

Deletes selected memories and their attachments using [`mem-cli delete`](../cli/delete.md)'s batch validation rules.

```json
{
  "roots": ["/workspace/app"],
  "repo": "/workspace/app",
  "path": ["/workspace/app/.memories/data/cache/memory.md"]
}
```

## Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| [`roots`, `repo`](./index.md#shared-parameters) | — | Yes | Workspace and active repository. |
| `path` | `string[]` | Yes | Nonempty array of `memory.md` paths or their directories. Relative paths resolve from the server's working directory; prefer returned absolute paths. |

The whole selection is validated before deletion. [`doNotDelete`](../memory/doNotDelete.md) blocks the batch. Nested memories must be selected explicitly when deleting their parent folder.

## Returns

A JSON array of deleted absolute `memory.md` paths, with descendants before parents.
