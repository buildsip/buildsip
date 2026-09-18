# mem-cli mcp

Starts the [MCP server](../mcp/index.md) over stdio.

```bash filename="Terminal"
mem-cli mcp
```

## Reference

This command has no workspace flags. Each tool call supplies its own [`roots` and `repo`](../mcp/index.md#shared-parameters).

Stdout is reserved for MCP protocol messages. Setup warnings go to stderr. The process serves requests until the client closes stdin.

For agent configuration, see [MCP installation](../mcp/installation.md).
