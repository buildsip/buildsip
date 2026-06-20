import { cancel } from "@clack/prompts";
import { findAuthStorePath, findBuildSipHomeDir } from "@buildsip/cli-auth";
import type { Command } from "commander";
import { log } from "../log";
import { findProjectStore } from "../buildsip-store";

export function registerPathsCommand(program: Command) {
  program
    .command("paths")
    .description("Show local BuildSip storage paths.")
    .action(async () => {
      try {
        const projectStore = await findProjectStore();

        process.stdout.write(
          `${JSON.stringify(
            {
              homeDir: findBuildSipHomeDir(),
              authStorePath: findAuthStorePath(),
              projectStore,
            },
            null,
            2,
          )}\n`,
        );
      } catch (error) {
        log.debug(error);
        cancel(
          error instanceof Error ? error.message : "Could not show paths.",
        );
        process.exitCode = 1;
      }
    });
}
