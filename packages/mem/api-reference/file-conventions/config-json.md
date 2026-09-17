# `config.json`

Store settings file at `.memories/config.json`.

```json
{
  "version": 1,
  "availableToWorkspace": false,
  "prune": false
}
```

Must be one JSON object with double-quoted keys. Comments and trailing commas are rejected.

## Inheritance

mem merges config from the Git root down to the owning repo or package directory. Closer files override parent values. Nested objects are merged field by field; `false` replaces a parent object.

[`availableToWorkspace`](../config/availableToWorkspace.md) and [`frontmatter.custom`](../config/frontmatter.md) may appear only in the Git root file.

A missing file is treated as `{}`.

## Related

- [Configuration](../config/index.md)
- [`mem init`](../cli/init.md)
