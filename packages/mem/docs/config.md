# `config.json`

Location: `.memories/config.json`

## availableToWorkspace

Optional. Defaults to false. If true, all memories in that `.memories` directory and all `.memories` directories down its directory tree are available to all other projects in the active workspace.

## frontmatter

### requireScope

Optional. Defaults to false. Makes the frontmatter `scope` field mandatory.

For the `.memories` directory at the root of your project's monorepo, it's highly recommended to set `requireScope` to `true` in order to avoid context pollution. See [how search works](./mcp.md#search-memories).

### custom

To use custom frontmatter fields for memories, you must define a JSON schema.

`config.json`:

```json
{
  "frontmatter": {
    "custom": {
      "properties": {
        "anchors": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "linear": {
          "type": "string"
        }
      },
      "required": ["anchors"],
      "additionalProperties": false
    }
  }
}
```

## prune

Default values:

```json
{
  "prune": {
    "enabled": false,
    "ttl": "90d",
    "humanUpvoteAdds": "180d",
    "agentUpvoteAdds": "90d"
  }
}
```

### enabled

Optional. Defaults to false. If set to true, it enables pruning.

### ttl

Memory must be at least this old to be eligible for pruning.

### humanUpvoteAdds

A human upvote adds this duration to the memory's lifetime.

### agentUpvoteAdds

An agent upvote adds this duration to the memory's lifetime.

## `config.json` Resolution

`mem-cli` resolves configuration by traversing upward from the active package directory to the repository root (`.git`).

Packages inherit `.memories/config.json` from the repository root by default.

If a package defines its own `.memories/config.json`, it is **deep-merged** on top of the root configuration (local keys override root defaults). Child packages only need to declare fields they intend to override.
