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

Undeclared extra fields are rejected. [`insert`](../cli/insert.md) and [`update`](../cli/update.md) always validate against this schema. [`search`](../cli/search.md) does too. [`delete`](../cli/delete.md) and [`update`](../cli/update.md) can still find an existing memory after the schema changes; publishing an update must pass the current schema.

## Related

- [`insert`](../cli/insert.md)
- [`memory.md`](../file-conventions/memory-md.md)
