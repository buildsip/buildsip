# mem-cli insert

`mem-cli insert` creates one memory from a JSON object. Search for a related memory before inserting.

```bash filename="Terminal"
mem-cli insert --roots /repo --repo /repo --input memory.json
```

```bash filename="Terminal"
mem-cli insert --roots /repo --repo /repo <<'EOF'
{
  "body": "Retry the client once after a reconnect; do not stack interceptors.",
  "frontmatter": {
    "title": "Axios retry duplication after reconnect",
    "scope": ["apps/web"]
  }
}
EOF
```

Stdout is a one-element JSON array of the saved absolute memory directory path. Use that path for later [`update`](./update.md) and [`delete`](./delete.md) calls.

> Good to know: Choose the narrowest [scope](../memory/scope.md) where the memory provides useful context. For example, a login-session cookie rule used throughout authentication belongs to `["apps/web/auth"]`. Use `["*"]` only for context useful across the whole repository.

## Reference

| Options | Description |
| --- | --- |
| [`--roots <path...>`](./index.md#--roots) | Workspace directories. Required. |
| [`--repo <path>`](./index.md#--repo) | Git root. Required. |
| [`--input <file>`](./index.md#--input) | JSON file, or `-` for stdin. |

### Input

| Field | Type | Required |
| --- | --- | --- |
| `body` | nonempty string | Yes |
| `frontmatter` | object | Yes |

Unknown top-level keys are rejected. Put title, scope, protection flags, and custom fields inside `frontmatter`.

| `frontmatter` field | Required |
| --- | --- |
| [`title`](../memory/title.md) | Yes |
| [`scope`](../memory/scope.md) | Yes. Nonempty array. |
| [`doNotEdit`](../memory/doNotEdit.md) | No |
| [`doNotDelete`](../memory/doNotDelete.md) | No |
| [`id`](../memory/id.md) | Omit. Generated on write. |
| Custom fields | No. Must be declared in [`frontmatter.custom`](../config/frontmatter.md). |

## Examples

### Repo-wide memory with custom fields

```json
{
  "body": "Staging database resets every Sunday.",
  "frontmatter": {
    "title": "Staging DB weekly reset",
    "scope": ["*"],
    "ticket": "ENG-123"
  }
}
```

`ticket` is only valid after you declare it. See [`frontmatter.custom`](../config/frontmatter.md).

## Related

- [`search`](./search.md)
- [`update`](./update.md)
- [`memory.md`](../file-conventions/memory-md.md)
