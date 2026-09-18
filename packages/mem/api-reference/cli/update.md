# mem-cli update

`mem-cli update` patches one existing memory. Only supplied fields change.

```bash filename="Terminal"
mem-cli update --roots /repo --repo /repo --path /repo/apps/web/.memories/data/axios-retry-duplication-after-reconnect --input update.json
```

```json
{
  "body": "Updated explanation."
}
```

Stdout is a one-element JSON array of the resulting absolute memory directory path. An update can rename or move the folder, so use the returned path for later calls.

A missing path is an error. Update never creates a memory.

## Reference

| Options | Description |
| --- | --- |
| [`--roots <path...>`](./index.md#--roots) | Workspace directories. Required. |
| [`--repo <path>`](./index.md#--repo) | Git root. Required. |
| `--path <path>` | Existing memory directory containing `memory.md`. Required. |
| [`--input <file>`](./index.md#--input) | JSON file, or `-` for stdin. |

`--path` resolves relative paths from the CLI working directory. The memory directory must live in a `.memories/data` store of `--repo`.

### Input

| Field | Type | Required |
| --- | --- | --- |
| `body` | nonempty string | No |
| `frontmatter` | object | No |

Unknown top-level keys, including `path`, are rejected. Select the memory with `--path`.

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
  "frontmatter": {
    "title": "Axios reconnect retry"
  }
}
```

### Repair the title folder

```bash filename="Terminal"
mem-cli update --roots /repo --repo /repo --path /repo/.memories/data/wrong-folder <<'EOF'
{}
EOF
```

See [`title`](../memory/title.md).

### Change scope

```json
{
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
