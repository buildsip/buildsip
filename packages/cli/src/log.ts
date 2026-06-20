import { inspect } from "node:util";
import { log as clackLog } from "@clack/prompts";
import pc from "picocolors";

let debugEnabled = false;

export const log = {
  ...clackLog,
  initialize(flags: { debug: boolean }) {
    debugEnabled = flags.debug;
  },
  debug(message: unknown) {
    if (debugEnabled) {
      clackLog.message(
        typeof message === "string" ? message : inspect(message),
        {
          symbol: pc.dim("◆"),
        },
      );
    }
  },
};
