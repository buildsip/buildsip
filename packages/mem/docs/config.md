# `config.json`

Location: `.memories/config.json`

Packages inherit configuration from the repository root.

## availableToWorkspace

Optional. Defaults to false. If true, all memories in that repository are available to all other projects in the active workspace.

> [!WARNING]
> `availableToWorkspace` can only be enabled in the `config.json` at the root of a repository.

## frontmatter

### custom

To use custom frontmatter fields for memories, define a JSON Schema.

> [!WARNING]
> `frontmatter.custom` can only be enabled in the `config.json` at the root of a repository. The schema applies to every memory in the repo.

Root `.memories/config.json`:

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

### Changing the schema

Existing memories remain searchable when you add, change, or remove custom field rules. Their files are not rewritten. Newly created or edited memories must satisfy the current schema.

## prune

Optional. Default value:

```json
{
  "prune": false
}
```

Providing an object enables pruning:

```json
{
  "prune": {
    "ttl": "90d",
    "humanUpvoteAdds": "180d",
    "agentUpvoteAdds": "90d"
  }
}
```

### ttl

Memory must be at least this old to be eligible for pruning.

### humanUpvoteAdds

A human upvote adds this duration to the memory's lifetime.

### agentUpvoteAdds

An agent upvote adds this duration to the memory's lifetime.

## `config.json` Resolution

Packages inherit settings from `.memories/config.json` files in their parent directories, up to the Git repository root.

A package can define its own pruning settings. Omitted values inherit the parent's settings; supplied values override them.
