# `availableToWorkspace`

When `true`, this repository's memories are included when another workspace project [searches](../cli/search.md).

```json
{
  "availableToWorkspace": true
}
```

Set this only in the Git root [`.memories/config.json`](../file-conventions/config-json.md). A package config that includes the key, even as `false`, is rejected.

Omitted or `false` keeps the memories local to that repo.

Only the root value is used. Package configs cannot override it.

[`mem init`](../cli/init.md) asks this only when configuring the Git root.

## Related

- [`search`](../cli/search.md)
- [`mem init`](../cli/init.md)
