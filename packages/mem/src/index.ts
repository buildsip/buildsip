#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cancel } from "@clack/prompts";
import { Command } from "commander";
import { registerDeleteCommand } from "./commands/delete-memories";
import { registerInitCommand } from "./commands/init";
import { registerSearchCommand } from "./commands/search";
import { registerInsertCommand } from "./commands/insert";
import { registerUpdateCommand } from "./commands/update";
import { NAMES } from "./names";
import { installMcp } from "./install-mcp";
import { createMcpServer } from "./create-mcp-server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// The built entry point lives in dist; its parent is the installed mem package.
const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(cliRoot, NAMES.PACKAGE_JSON), "utf8"));
// Route Commander errors through our catch block so agent commands return JSON errors.
const program = new Command().name("mem-cli").version(pkg.version).exitOverride();
program.configureOutput({ writeErr: () => {} });

registerInitCommand({ program, cliRoot });
registerSearchCommand({ program });
registerInsertCommand({ program });
registerUpdateCommand({ program });
registerDeleteCommand({ program });
program
  .command("mcp")
  .description("Serve memory tools over MCP using stdin and stdout.")
  .action(async () => {
    const server = createMcpServer({ version: pkg.version });
    await server.connect(new StdioServerTransport());
  });

program.action(() => program.help());

try {
  // This also runs for help, version, and MCP startup. Never write setup messages to stdout:
  // command output is JSON, and MCP clients reserve stdout for protocol messages.
  await installMcp({
    log: { warn: (message) => process.stderr.write(`${JSON.stringify({ warning: message })}\n`) },
  });
  await program.parseAsync(process.argv);
} catch (error) {
  const code = (error as { code?: string }).code;
  if (code !== "commander.helpDisplayed" && code !== "commander.version") {
    const message = error instanceof Error ? error.message : "mem-cli failed.";
    if (process.argv[2] === "init") cancel(message);
    else process.stderr.write(`${JSON.stringify({ error: message })}\n`);
    process.exitCode = 1;
  }
}
