import { resolve } from "node:path";
import { normalizeAlias } from "./normalize-alias";
import type { BuildSipConfig } from "./types";

export function removeAlias(input: { config: BuildSipConfig; root: string; alias: string }) {
  const { config, root, alias } = input;
  const normalizedRoot = resolve(root);
  const normalizedAlias = resolve(alias);
  let removed = false;

  const projects = config.projects
    .map(normalizeAlias)
    .map((entry) => {
      if (entry.root !== normalizedRoot) {
        return entry;
      }

      const aliases = entry.aliases.filter((item) => item !== normalizedAlias);
      removed = aliases.length !== entry.aliases.length;
      return { ...entry, aliases };
    })
    .filter((entry) => entry.aliases.length > 0);

  return {
    removed,
    config: { projects },
  };
}
