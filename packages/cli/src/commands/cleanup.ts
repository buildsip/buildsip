import { cancel } from "@clack/prompts";
import type { Command } from "commander";
import { rm } from "node:fs/promises";
import { log } from "../log";
import { resolveTempFolder } from "../resolve-temp-folder";

export function registerCleanupCommand(program: Command) {
  program
    .command("cleanup")
    .description(
      "Delete a temp folder, which contains prepared logs and stories only needed for the upload.",
    )
    .argument("<temp>", "Temp folder name from prepare")
    .action(async (temp: string) => {
      try {
        const { tempDir } = await resolveTempFolder(temp);
        await rm(tempDir, { recursive: true, force: true });

        console.log(`Deleted ${tempDir}`);
      } catch (error) {
        log.debug(error);
        cancel(error instanceof Error ? error.message : "Cleanup failed.");
        process.exitCode = 1;
      }
    });
}
