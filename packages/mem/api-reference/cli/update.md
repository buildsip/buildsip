# mem update

`mem update` patches one existing memory. Only supplied fields change.

```bash filename="Terminal"
mem update --roots /repo --repo /repo --input update.json
```

```json
{
  "path": "/repo/apps/web/.memories/data/axios-retry-duplication-after-reconnect/memory.md",
  "body": "Updated explanation."
}
```

Stdout is a one-element JSON array of the resulting absolute `memory.md` path. An update can rename or move the folder, so use the returned path for later calls.

A missing path is an error. Update never creates a memory.

## Reference

| Options | Description |
| --- | --- |
| [`--roots <path...>`](./index.md#--roots) | Workspace directories. Required. |
| [`--repo <path>`](./index.md#--repo) | Git root. Required. |
| [`--input <file>`](./index.md#--input) | JSON file, or `-` for stdin. |

### Input

| Field | Type | Required |
| --- | --- | --- |
| `path` | nonempty string | Yes |
| `body` | nonempty string | No |
| `frontmatter` | object | No |

Unknown top-level keys are rejected.

`path` is an existing `memory.md` file or its directory. Relative paths resolve from the CLI working directory. The file must live in a `.memories/data` store of `--repo`.

Omitted `body` and omitted `frontmatter` keys keep their stored values, including custom fields and [scope](../memory/scope.md). `null` is a value, not a deletion. Removing fields is not supported.

| `frontmatter` field | On supply |
| --- | --- |
| [`title`](../memory/title.md) | Overwrites title. |
| [`scope`](../memory/scope.md) | Recomputes placement. |
| [`doNotEdit`](../memory/doNotEdit.md) | Overwrites the flag. |
| [`doNotDelete`](../memory/doNotDelete.md) | Overwrites the flag. |
| [`id`](../memory/id.md) | Omit. |
| Custom fields | Merged by field name. An object or array replaces that field. |

[`doNotEdit`](../memory/doNotEdit.md) blocks the whole command, including a call that tries to set it to `false`. Nested memories inside the folder must be moved out first. [`memory.md` directly inside `data/`](../file-conventions/data.md) is rejected. Destination collisions are rejected. Failed publication rolls back any folder move.

Writes validate custom fields against the repository root schema before publication, including when scope moves a memory between packages.

## Examples

### Title only

```json
{
  "path": "/repo/apps/web/.memories/data/axios-retry-duplication-after-reconnect/memory.md",
  "frontmatter": {
    "title": "Axios reconnect retry"
  }
}
```

### Directory path

```json
{
  "path": "/repo/.memories/data/wrong-folder"
}
```

See [`title`](../memory/title.md).

### Change scope

```json
{
  "path": "/repo/.memories/data/legacy-memory/memory.md",
  "frontmatter": {
    "scope": ["apps/web"]
  }
}
```

See [`scope`](../memory/scope.md).

## Related

- [`insert`](./insert.md)
- [`search`](./search.md)
- [`doNotEdit`](../memory/doNotEdit.md)
