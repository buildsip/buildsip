import { uninstallGlobalHooks } from "@buildsip/hooks";
import { cancel, intro, outro, spinner } from "@clack/prompts";
import type { Command } from "commander";
import pc from "picocolors";
import { log } from "../log";
import { uninstallNoteSkill } from "../note-skill";

export function registerUninstallCommand(program: Command) {
  program
    .command("uninstall")
    .description("Remove BuildSip hooks and note skill from every agent harness.")
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

      progress.start("Removing note skill.");

      try {
        await uninstallNoteSkill();
        progress.stop("Note skill removed.");
      } catch (error) {
        log.debug(error);
        progress.stop("Note skill could not be removed.");
        failures.push(
          error instanceof Error ? `Note skill: ${error.message}` : "Note skill cleanup failed.",
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

      const removeStoreInstruction =
        process.platform === "win32"
          ? `delete ${pc.greenBright("%USERPROFILE%\\.buildsip")} in File Explorer`
          : `run ${pc.greenBright("rm -r ~/.buildsip")}`;

      outro(
        `BuildSip integrations removed.\n\nTo remove your Local Store, ${removeStoreInstruction}.\n\nTo remove the CLI, run ${pc.greenBright("npm uninstall -g buildsip")}.`,
      );
    });
}
