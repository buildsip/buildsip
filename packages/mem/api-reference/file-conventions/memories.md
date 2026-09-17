# `.memories`

The memory store directory. Allowed only at a package root or the Git root.

[`mem init`](../cli/init.md) creates it when writing the first [`config.json`](./config-json.md) for that target. [`mem insert`](../cli/insert.md) can create it when placing a memory in a package that has no store yet.

It must be a directory. A file at that path is rejected.

## Related

- [`config.json`](./config-json.md)
- [`data/`](./data.md)
