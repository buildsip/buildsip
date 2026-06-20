import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter } from "../../types";
import { normalizeOpenAI } from "../normalize-openai";

export const codex = {
  label: "Codex",
  name: "codex",
  globalPath: join(homedir(), ".codex", "hooks.json"),
  parse(input: unknown) {
    return normalizeOpenAI(input, "codex");
  },
} as const satisfies Adapter;
