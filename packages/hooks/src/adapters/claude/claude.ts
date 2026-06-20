import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter } from "../../types";
import { normalizeOpenAI } from "../normalize-openai";

export const claude = {
  label: "Claude Code",
  name: "claude-code",
  globalPath: join(homedir(), ".claude", "settings.json"),
  parse(input: unknown) {
    return normalizeOpenAI(input, "claude-code");
  },
} as const satisfies Adapter;
