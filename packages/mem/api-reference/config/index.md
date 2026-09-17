# Configuration

Fields in [`.memories/config.json`](../file-conventions/config-json.md).

Unknown keys are rejected. Allowed fields: `version`, `availableToWorkspace`, `frontmatter`, `prune`.

```json
{
  "version": 1,
  "availableToWorkspace": false,
  "frontmatter": {
    "custom": {
      "properties": {
        "ticket": { "type": "string" }
      }
    }
  },
  "prune": {
    "ttl": "90d",
    "humanUpvoteAdds": "180d",
    "agentUpvoteAdds": "90d"
  }
}
```

- [`version`](./version.md)
- [`availableToWorkspace`](./availableToWorkspace.md)
- [`frontmatter`](./frontmatter.md)
- [`prune`](./prune.md)
