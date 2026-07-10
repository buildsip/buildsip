import { cancel } from "@clack/prompts";
import { findAuthStorePath, findBuildSipHomeDir } from "@buildsip/cli-auth";
import type { Command } from "commander";
import { findConfigPath } from "../alias";
import { findBuildSipStore } from "../build-sip-store";
import { log } from "../log";

export function registerPathsCommand(program: Command) {
  program
    .command("paths")
    .description("Show local BuildSip storage paths.")
    .action(async () => {
      try {
        const buildSipStore = await findBuildSipStore();

        process.stdout.write(
          `${JSON.stringify(
            {
              homeDir: findBuildSipHomeDir(),
              authStorePath: findAuthStorePath(),
              configPath: findConfigPath(),
              buildSipStore,
            },
            null,
            2,
          )}\n`,
        );
      } catch (error) {
        log.debug(error);
        cancel(error instanceof Error ? error.message : "Could not show paths.");
        process.exitCode = 1;
      }
    });
}
