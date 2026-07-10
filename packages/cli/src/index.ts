#!/usr/bin/env node

import { cancel } from "@clack/prompts";
import { Command } from "commander";
import { registerAliasCommand } from "./commands/alias";
import { registerInitCommand } from "./commands/init";
import { registerLoginCommand } from "./commands/login";
import { registerLogCommand } from "./commands/log";
import { registerLogoutCommand } from "./commands/logout";
import { registerPathsCommand } from "./commands/paths";
import { registerPrepareCommand } from "./commands/prepare";
import { registerUploadCommand } from "./commands/upload";
import { registerWhoamiCommand } from "./commands/whoami";
import { registerCleanupCommand } from "./commands/cleanup";
import { log } from "./log";
import { loadEnvFile } from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { findPackageRoot } from "./package-root";
import { join } from "node:path";

const packageRoot = findPackageRoot();

const program = new Command()
  .name("buildsip")
  .version(JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version)
  .option("-d, --debug", "Print debug output.");

program.hook("preAction", (command) => {
  log.initialize({ debug: Boolean(command.optsWithGlobals().debug) });
});

registerAliasCommand(program);
registerInitCommand(program);
registerLoginCommand(program);
registerLogCommand(program);
registerLogoutCommand(program);
registerPathsCommand(program);
registerPrepareCommand(program);
registerUploadCommand(program);
registerWhoamiCommand(program);
registerCleanupCommand(program);

program.action(() => {
  program.help();
});

try {
  const envPath = join(packageRoot, ".env");

  if (existsSync(envPath)) {
    loadEnvFile(envPath);
  }

  await program.parseAsync(process.argv);
} catch (error) {
  log.debug(error);
  cancel(error instanceof Error ? error.message : "BuildSip failed.");
  process.exitCode = 1;
}
