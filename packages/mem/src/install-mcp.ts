import { detectGlobalAgents, upsertServer } from "add-mcp";
import { mcpTools } from "./mcp-tools";

const help =
  'Install the mem-cli MCP server manually with command mem-cli and arguments ["mcp"], then restart the agent. See https://github.com/buildsip/buildsip/blob/main/packages/mem/api-reference/mcp/installation.md';

/** Refreshes detected agents on every invocation; a failed config must not block the CLI. */
export async function installMcp(ctx: { log: { warn: (message: string) => void } }) {
  try {
    const agents = await detectGlobalAgents();
    if (!agents.length) {
      ctx.log.warn(`No installed agents were detected. ${help}`);
      return;
    }
    for (const agent of agents) {
      try {
        // Explicit global scope avoids project config changes. No cached version can go stale.
        const result = upsertServer(
          agent,
          "mem-cli",
          {
            command: "mem-cli",
            args: ["mcp"],
            autoApproveTools: mcpTools.map((tool) => tool.name),
          },
          { local: false },
        );
        if (!result.success) {
          ctx.log.warn(
            `Could not install mem-cli for ${agent} at ${result.path}: ${result.error ?? "unknown error"}. Fix this agent's config and run the CLI again. ${help}`,
          );
        }
      } catch (error) {
        // The SDK returns failures today; keep going if an adapter throws in a future release.
        ctx.log.warn(
          `Could not install mem-cli for ${agent}: ${error instanceof Error ? error.message : String(error)}. ${help}`,
        );
      }
    }
  } catch (error) {
    ctx.log.warn(
      `Could not detect installed agents: ${error instanceof Error ? error.message : String(error)}. ${help}`,
    );
  }
}
