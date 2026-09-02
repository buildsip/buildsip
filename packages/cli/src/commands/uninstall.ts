import { uninstallGlobalHooks } from "@buildsip/hooks";
import { cancel, intro, outro, spinner } from "@clack/prompts";
import type { Command } from "commander";
import pc from "picocolors";
import { log } from "../log";
import { uninstallStorySkill } from "../story-skill";

export function registerUninstallCommand(program: Command) {
  program
    .command("uninstall")
    .description("Remove BuildSip hooks and story skill from every agent harness.")
    .action(async () => {
      intro(pc.greenBright("BuildSip uninstall"));
      const progress = spinner();
      const failures: string[] = [];

      progress.start("Removing agent hooks.");
      const hooks = await uninstallGlobalHooks();
      const removed = hooks.results.reduce((count, result) => count + result.removed, 0);

      for (const failure of hooks.failures) {
        log.debug(failure.error);
        failures.push(`${failure.label} hooks at ${failure.path}: ${failure.error.message}`);
      }

      progress.stop(removed === 0 ? "Agent hooks already removed." : "Agent hooks removed.");

      progress.start("Removing story skill.");

      try {
        await uninstallStorySkill();
        progress.stop("Story skill removed.");
      } catch (error) {
        log.debug(error);
        progress.stop("Story skill could not be removed.");
        failures.push(
          error instanceof Error ? `Story skill: ${error.message}` : "Story skill cleanup failed.",
        );
      }

      if (failures.length > 0) {
        for (const failure of failures) {
          log.error(failure);
        }

        cancel("BuildSip uninstall incomplete.");
        process.exitCode = 1;
        return;
      }

      outro(
        `BuildSip integrations removed. Your Local Store was kept.\n\nTo remove the CLI, run ${pc.greenBright("npm uninstall -g buildsip")}.`,
      );
    });
}
