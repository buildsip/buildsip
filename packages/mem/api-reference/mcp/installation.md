# MCP installation

Every CLI invocation installs or refreshes the global `mem-cli` server entry for agents detected by [add-mcp](https://add-mcp.com/docs/sdk). This includes help, version, [`init`](../cli/init.md), and [`mcp`](../cli/mcp.md).

The registered process is `mem-cli mcp`. There is no installation prompt or saved version check. Existing entries are overwritten, and the four current [tool names](./index.md#tools) are passed as named auto-approvals wherever the agent supports them.

Other server entries are preserved. Configs for undetected agents are not created.

## Manual setup

If detection finds no agents or a config cannot be written, the CLI warns on stderr and continues. Configure a stdio server named `mem-cli` with command `mem-cli` and arguments `["mcp"]`, then restart the agent's MCP connection.

For Cursor, merge this entry into the existing `mcpServers` object in `~/.cursor/mcp.json`:

```json filename="~/.cursor/mcp.json"
{
  "mcpServers": {
    "mem-cli": {
      "command": "mem-cli",
      "args": ["mcp"]
    }
  }
}
```

Other agents use different config formats. The add-mcp SDK handles those formats and named auto-approval:

```ts
import { upsertServer } from "add-mcp";

const result = upsertServer(
  "claude-code",
  "mem-cli",
  {
    command: "mem-cli",
    args: ["mcp"],
    autoApproveTools: [
      "insert-memory",
      "update-memory",
      "search-memories",
      "delete-memories",
    ],
  },
  { local: false },
);

if (!result.success) console.error(result.error);
```

Auto-approval support depends on the agent. Restart the MCP connection after upgrading the CLI so the agent loads the current tools. Registration refreshes the saved launch command and approval rules; it does not restart an already running server.
