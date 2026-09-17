# `data`

Folder of `memory.md` files and attachments, created on the first [`insert`](../cli/insert.md).

```txt
.memories/data/errors/axios-reconnect-retry/memory.md
```

Each memory lives in its own title-named directory. See [`title`](../memory/title.md).

`memory.md` cannot be a direct child of `data/`.

Directories whose names start with `.mem-` are temporary write stages and are ignored when loading memories.

## Tags

Directories between `data/` and the title folder are search tags. [`update`](../cli/update.md) keeps them when renaming the title folder or moving stores.

```txt
.memories/data/errors/network/cache-rule/memory.md
```

Searching for `errors` can hit that memory. See [`search`](../cli/search.md).

## Attachments

Any sibling of `memory.md` moves with the folder on update, including nested directories.

## Related

- [`memory.md`](./memory-md.md)
- [`delete`](../cli/delete.md)
