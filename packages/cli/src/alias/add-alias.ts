import { resolve } from "node:path";
import { isInsideRoot } from "./is-inside-root";
import { normalizeAlias } from "./normalize-alias";
import type { BuildSipConfig } from "./types";

export function addAlias(input: { config: BuildSipConfig; root: string; alias: string }) {
  const { config, root, alias } = input;
  const normalizedRoot = resolve(root);
  const normalizedAlias = resolve(alias);

  if (normalizedAlias === normalizedRoot) {
    throw new Error("A root cannot alias itself.");
  }

  if (isInsideRoot({ root: normalizedRoot, path: normalizedAlias })) {
    throw new Error("An alias cannot be inside the current root.");
  }

  const projects = config.projects.map(normalizeAlias);
  const entry = projects.find((item) => item.root === normalizedRoot);

  if (!entry) {
    return {
      added: true,
      config: {
        projects: [...projects, { root: normalizedRoot, aliases: [normalizedAlias] }],
      },
    };
  }

  if (entry.aliases.includes(normalizedAlias)) {
    return { added: false, config: { projects } };
  }

  return {
    added: true,
    config: {
      projects: projects.map((item) =>
        item.root === normalizedRoot
          ? { ...item, aliases: [...item.aliases, normalizedAlias] }
          : item,
      ),
    },
  };
}
