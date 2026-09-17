# `frontmatter`

Declares extra memory fields. The only allowed key is `custom`, a JSON Schema object merged into `{ "type": "object", ...schema }` and checked with Ajv (formats such as `uri` are enabled).

```json
{
  "frontmatter": {
    "custom": {
      "properties": {
        "ticket": { "type": "string", "pattern": "^ENG-" },
        "anchors": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["ticket"]
    }
  }
}
```

Define `custom` only in the Git root [`.memories/config.json`](../file-conventions/config-json.md). One schema applies to every memory in the repo. Package configs cannot set, replace, or extend it.

Custom fields go next to [`title`](../memory/title.md) in YAML and in insert/update JSON, not inside a nested `custom` object.

[`insert`](../cli/insert.md) and [`update`](../cli/update.md) validate the complete memory against the current schema before writing. Without a custom schema, extra fields are rejected.

## Schema changes

Existing files are not migrated or revalidated against custom schema changes when read. [`search`](../cli/search.md) keeps their custom fields searchable, and [`delete`](../cli/delete.md) can still remove them. Built-in fields such as `id`, `title`, and protection flags are always validated.

Adding an optional field leaves old memories valid. Adding a required field leaves old memories searchable, but the next insert or update must include it. For example, after adding `"required": ["ticket"]`, updating an old memory without `ticket` fails until it is supplied in `frontmatter`.

## Related

- [`insert`](../cli/insert.md)
- [`memory.md`](../file-conventions/memory-md.md)
