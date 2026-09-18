# mem-cli delete

`mem-cli delete` removes memory folders, including attachments.

```bash filename="Terminal"
mem-cli delete --roots /repo --repo /repo --path /repo/.memories/data/staging-db-weekly-reset
```

Stdout is a JSON array of deleted absolute memory directory paths, descendants before parents.

The whole selection is validated before anything is deleted.

## Reference

| Options | Description |
| --- | --- |
| [`--roots <path...>`](./index.md#--roots) | Workspace directories. Required. |
| [`--repo <path>`](./index.md#--repo) | Git root. Required. |
| `--path <path...>` | Memory directories containing `memory.md`. Repeatable. Required. |

Relative paths resolve from the CLI working directory. Duplicate paths are ignored.

Each path must be a memory in `--repo`. Paths in another workspace repo are rejected.

[`doNotDelete`](../memory/doNotDelete.md) rejects the whole batch. [`doNotEdit`](../memory/doNotEdit.md) does not.

A parent folder that contains another memory is rejected unless that nested memory is also listed in `--path`.

You cannot delete the [`data/`](../file-conventions/data.md) directory itself.

Delete can remove a memory whose custom fields no longer match the current schema.

## Examples

### Multiple memories

```bash filename="Terminal"
mem-cli delete --roots /repo --repo /repo \
  --path /repo/.memories/data/one \
  --path /repo/.memories/data/two
```

### Nested memories

```bash filename="Terminal"
mem-cli delete --roots /repo --repo /repo \
  --path /repo/.memories/data/parent/nested \
  --path /repo/.memories/data/parent
```

Deleting only `parent` fails while `nested` remains.

## Related

- [`search`](./search.md)
- [`doNotDelete`](../memory/doNotDelete.md)
