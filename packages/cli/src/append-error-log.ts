import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { findProjectStore } from "./buildsip-store";

type ErrorLogEntry = {
  agent?: string;
  at: string;
  type: string;
  message: string;
};

export async function appendErrorLog(params: { agent?: string; type: string; message: string }) {
  try {
    const { errorsPath } = await findProjectStore();
    const entry: ErrorLogEntry = {
      at: new Date().toISOString(),
      type: params.type,
      message: params.message,
      ...(params.agent === undefined ? {} : { agent: params.agent }),
    };

    await mkdir(dirname(errorsPath), { recursive: true });
    await appendFile(errorsPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`BuildSip error log write failed: ${message}`);
  }
}
