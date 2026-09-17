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

// The built entry point lives in dist; its parent is the installed mem package.
const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(cliRoot, NAMES.PACKAGE_JSON), "utf8"));
// Route Commander errors through our catch block so agent commands return JSON errors.
const program = new Command().name("mem").version(pkg.version).exitOverride();
program.configureOutput({ writeErr: () => {} });

registerInitCommand({ program, cliRoot });
registerSearchCommand({ program });
registerInsertCommand({ program });
registerUpdateCommand({ program });
registerDeleteCommand({ program });

program.action(() => program.help());

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const code = (error as { code?: string }).code;
  if (code !== "commander.helpDisplayed" && code !== "commander.version") {
    const message = error instanceof Error ? error.message : "mem failed.";
    if (process.argv[2] === "init") cancel(message);
    else process.stderr.write(`${JSON.stringify({ error: message })}\n`);
    process.exitCode = 1;
  }
}
