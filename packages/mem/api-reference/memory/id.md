# `id`

Stable identifier. A nonempty string. [`insert`](../cli/insert.md) writes a UUID.

```yaml
id: 11111111-1111-4111-8111-111111111111
```

Omit `id` on insert and [`update`](../cli/update.md) input. Insert generates it. Update keeps the stored value. Supplying it, including `null`, is rejected.

Updates select the memory by [`path`](../cli/update.md), not by `id`.
