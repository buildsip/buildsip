import { claude } from "./claude";
import { codex } from "./codex";
import { cursor } from "./cursor";

export const adapters = [codex, claude, cursor] as const;

export type Name = (typeof adapters)[number]["name"];

export type { EventName } from "../types";

export * from "./claude";
export * from "./codex";
export * from "./cursor";
export * from "./openai-schema";
