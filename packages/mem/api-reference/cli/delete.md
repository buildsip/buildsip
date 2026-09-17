# mem delete

`mem delete` removes memory folders, including attachments.

```bash filename="Terminal"
mem delete --roots /repo --repo /repo --path /repo/.memories/data/staging-db-weekly-reset/memory.md
```

Stdout is a JSON array of deleted `memory.md` paths, descendants before parents.

The whole selection is validated before anything is deleted.

## Reference

| Options | Description |
| --- | --- |
| [`--roots <path...>`](./index.md#--roots) | Workspace directories. Required. |
| [`--repo <path>`](./index.md#--repo) | Git root. Required. |
| `--path <path...>` | `memory.md` files or their directories. Repeatable. Required. |

Relative paths resolve from the CLI working directory. Duplicate paths are ignored.

Each path must be a memory in `--repo`. Paths in another workspace repo are rejected.

[`doNotDelete`](../memory/doNotDelete.md) rejects the whole batch. [`doNotEdit`](../memory/doNotEdit.md) does not.

A parent folder that contains another memory is rejected unless that nested memory is also listed in `--path`.

You cannot delete the [`data/`](../file-conventions/data.md) directory itself.

Delete can remove a memory whose custom fields no longer match the current schema.

## Examples

### File and folder in one call

```bash filename="Terminal"
mem delete --roots /repo --repo /repo \
  --path /repo/.memories/data/one/memory.md \
  --path /repo/.memories/data/two
```

### Nested memories

```bash filename="Terminal"
mem delete --roots /repo --repo /repo \
  --path /repo/.memories/data/parent/nested/memory.md \
  --path /repo/.memories/data/parent/memory.md
```

Deleting only `parent` fails while `nested` remains.

## Related

- [`search`](./search.md)
- [`doNotDelete`](../memory/doNotDelete.md)
