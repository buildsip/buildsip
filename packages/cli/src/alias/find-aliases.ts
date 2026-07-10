import { resolve } from "node:path";
import type { BuildSipConfig } from "./types";

export function findAliases(input: { config: BuildSipConfig; root: string }) {
  const root = resolve(input.root);
  return input.config.projects.find((entry) => resolve(entry.root) === root)?.aliases ?? [];
}
