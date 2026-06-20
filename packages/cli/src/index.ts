#!/usr/bin/env node

import { cancel } from "@clack/prompts";
import { Command } from "commander";
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
import { existsSync } from "node:fs";
import { findPackageRoot } from "./package-root";
import { join } from "node:path";

const program = new Command()
  .name("buildsip")
  .version("0.0.0")
  .option("-d, --debug", "Print debug output.");

program.hook("preAction", (command) => {
  log.initialize({ debug: Boolean(command.optsWithGlobals().debug) });
});

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
  const envPath = join(findPackageRoot(), ".env");

  if (existsSync(envPath)) {
    loadEnvFile(envPath);
  }

  await program.parseAsync(process.argv);
} catch (error) {
  log.debug(error);
  cancel(error instanceof Error ? error.message : "BuildSip failed.");
  process.exitCode = 1;
}
