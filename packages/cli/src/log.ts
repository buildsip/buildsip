import { inspect } from "node:util";
import { log as clackLog } from "@clack/prompts";
import pc from "picocolors";

let debugEnabled = false;

function logMessage(messages: unknown[]) {
  return messages
    .map((message) => (typeof message === "string" ? message : inspect(message)))
    .join(" ");
}

export const log = {
  ...clackLog,
  initialize(flags: { debug: boolean }) {
    debugEnabled = flags.debug;
  },
  debug(...messages: unknown[]) {
    if (debugEnabled) {
      clackLog.message(logMessage(messages), {
        symbol: pc.dim("◆"),
      });
    }
  },
  warn(...messages: unknown[]) {
    clackLog.warn(logMessage(messages));
  },
};
