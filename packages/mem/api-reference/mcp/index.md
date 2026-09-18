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

Success returns the same JSON as the corresponding CLI command in the first text content block. [`insert-memory`](./insert-memory.md) and [`update-memory`](./update-memory.md) add a second text block with [categorization guidance](#categorization-guidance). Failures return `isError: true` with an instruction string in one text block, without an additional `{ "error": ... }` wrapper.

```json
{
  "content": [
    {
      "type": "text",
      "text": "[\"/workspace/app/.memories/data/cache\"]"
    }
  ]
}
```

The server stays available after tool errors. Its initialize response reports the running package version.

### Categorization guidance

After an insert or update, the second text block identifies the saved memory directory and its owning `.memories/data` directory. The agent may move the whole memory directory within that exact data directory and create parent category folders. It must keep the memory folder's name and contents together, avoid other memory directories and symbolic links, and use the new path for later calls.

Category names should help users browse their memories. These parent directories also act as [search tags](../file-conventions/data.md#tags).

The block ends with a sorted directory listing relative to the owning `.memories` folder:

```text
data/
data/network/
data/network/http/
data/rendering/
data/rendering/hydration/
data/state/
data/state/zustand/
data/state/zustand/selectors/
```

The listing includes empty category folders and excludes memory folders and their contents, files, symbolic links, and temporary `.mem-` folders. A store without categories shows only `data/`. If the listing cannot be read, the block tells the agent to inspect the data directory; the save remains successful.
