# `doNotEdit`

When `true`, [`update`](../cli/update.md) is rejected, including path-only repairs and attempts to set this flag to `false`.

```yaml
doNotEdit: true
```

Must be a boolean. Omit it to keep the current value on update.

[`delete`](../cli/delete.md) does not read this flag. See [`doNotDelete`](./doNotDelete.md).
