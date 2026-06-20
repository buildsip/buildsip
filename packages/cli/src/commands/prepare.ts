import { cancel } from "@clack/prompts";
import type { Command } from "commander";
import { log } from "../log";
import {
  prepareTempLogs,
  type PrepareTempLogsOptions,
} from "../prepare-temp-logs";

export function registerPrepareCommand(program: Command) {
  program
    .command("prepare")
    .description(
      "Rebuild temp logs from the current project's filtered conversation logs (default: last 7 days).",
    )
    .option("--hours <hours>", "Include messages from the last N hours")
    .option("--days <days>", "Include messages from the last N days")
    .option("--date <date>", "Include messages for a calendar day (YYYY-MM-DD)")
    .option("--since <iso>", "Include messages at or after this timestamp")
    .option("--until <iso>", "Include messages before this timestamp")
    .action(async (options: PrepareTempLogsOptions) => {
      try {
        const result = await prepareTempLogs(options);
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } catch (error) {
        log.debug(error);
        cancel(error instanceof Error ? error.message : "Prepare failed.");
        process.exitCode = 1;
      }
    });
}
