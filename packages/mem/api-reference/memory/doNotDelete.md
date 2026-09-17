# `doNotDelete`

When `true`, [`delete`](../cli/delete.md) is rejected for that memory. A batch that includes one protected path deletes nothing.

```yaml
doNotDelete: true
```

Must be a boolean. Omit it to keep the current value on update.

[`update`](../cli/update.md) does not read this flag. See [`doNotEdit`](./doNotEdit.md).
