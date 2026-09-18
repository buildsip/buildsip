import { agents, detectGlobalAgents, upsertServer } from "add-mcp";
import { mcpTools } from "./mcp-tools";

const help =
  'Install the mem-cli MCP server manually with command mem-cli and arguments ["mcp"], then restart the agent. See https://github.com/buildsip/buildsip/blob/main/packages/mem/api-reference/mcp/installation.md';

/** Refreshes detected agents and returns the display names of successful installations. */
export async function installMcp(ctx: { log: { warn: (message: string) => void } }) {
  const installed: string[] = [];
  try {
    const detected = await detectGlobalAgents();
    if (!detected.length) {
      ctx.log.warn(`No installed agents were detected. ${help}`);
      return installed;
    }
    for (const agent of detected) {
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
        } else {
          // Report only agents whose config was saved, including refreshed installations.
          installed.push(agents[agent].displayName);
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
  return installed;
}
