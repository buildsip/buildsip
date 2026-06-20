import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import { prettifyError, ZodError } from "zod";
import { parse } from "@buildsip/hooks";
import { appendErrorLog } from "../append-error-log";
import { findProjectStore } from "../buildsip-store";

type LogCommandOptions = {
  agent?: string;
};

function readStdin() {
  return new Promise<string>((resolve, reject) => {
    let input = "";

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => {
      resolve(input);
    });
    process.stdin.on("error", reject);
  });
}

export function registerLogCommand(program: Command) {
  program
    .command("log")
    .description("Log an AI chat event.")
    .option("--agent <agent>", "Agent that emitted the payload.")
    .action(async (options: LogCommandOptions) => {
      try {
        const input = await readStdin();

        if (input.trim().length === 0) {
          return;
        }

        const result = parse(JSON.parse(input), options.agent);

        if (result.error !== null) {
          if (
            "type" in result.error &&
            result.error.type === "unknown-adapter"
          ) {
            await appendErrorLog({
              type: "unknown_adapter",
              agent: options.agent,
              message: `Unknown adapter: ${result.error.name}.`,
            });
          }

          if (result.error instanceof ZodError) {
            await appendErrorLog({
              type: "schema_mismatch",
              agent: options.agent,
              message: prettifyError(result.error),
            });
          }

          return;
        }

        if (result.data === null) {
          return;
        }

        const event = result.data;
        const { logsDir } = await findProjectStore();
        // Prefixing to avoid id collisions with other agents.
        const logPath = join(logsDir, `${event.name}_${event.sessionId}.jsonl`);
        const entry = {
          cwd: event.cwd,
          eventName: event.eventName,
          ...event.message,
          model: event.model,
          timestamp: new Date().toISOString(),
        };

        await mkdir(logsDir, { recursive: true });

        const logContent = await readFile(logPath, "utf8").catch((error) => {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ) {
            return null;
          }

          throw error;
        });
        const lines =
          logContent === null
            ? []
            : logContent.split("\n").filter((line) => line.trim().length > 0);
        const lastLine = lines.at(-1);
        const lastMessage =
          lastLine === undefined ? null : JSON.parse(lastLine);

        // Duplicate check.
        if (
          typeof lastMessage === "object" &&
          lastMessage !== null &&
          lastMessage.role === entry.role &&
          lastMessage.content === entry.content
        ) {
          return;
        }

        await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        await appendErrorLog({
          type: "log_failed",
          agent: options.agent,
          message,
        });
        console.error(`BuildSip conversation log failed: ${message}`);
        process.exitCode = 1;
      }
    });
}
