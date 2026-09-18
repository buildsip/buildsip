# MCP

The `mem-cli` MCP server exposes memory commands over stdio. See [installation](./installation.md) to connect an agent.

## Tools

| Tool | Description |
| --- | --- |
| [`insert-memory`](./insert-memory.md) | Create one memory. |
| [`update-memory`](./update-memory.md) | Patch an existing memory. |
| [`search-memories`](./search-memories.md) | Search saved memories. |
| [`delete-memories`](./delete-memories.md) | Delete memories and attachments. |

## Shared parameters

Every tool requires these fields:

| Parameter | Type | Description |
| --- | --- | --- |
| `roots` | `string[]` | Absolute paths of every workspace folder, including shared memory repositories. Must contain at least one directory. |
| `repo` | `string` | Absolute Git root of the active project, inside one of `roots`. Package directories are rejected. |

```json
{
  "roots": ["/workspace/app", "/workspace/team-memories"],
  "repo": "/workspace/app"
}
```

Arguments are structured objects. Do not encode them as a JSON string or pass CLI flags. Field descriptions and required fields are included in each tool's JSON Schema. Custom frontmatter is validated against the destination store's [configuration](../config/frontmatter.md).

The server does not infer workspace folders from its working directory or request MCP roots from the client.

## Results

Success returns one text content block containing the same JSON as the corresponding CLI command. Failures return `isError: true` with an instruction string in the text block, without an additional `{ "error": ... }` wrapper.

```json
{
  "content": [
    {
      "type": "text",
      "text": "[\"/workspace/app/.memories/data/cache/memory.md\"]"
    }
  ]
}
```

The server stays available after tool errors. Its initialize response reports the running package version.
