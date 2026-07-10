import { resolve } from "node:path";
import { isInsideRoot } from "./is-inside-root";
import type { Alias } from "./types";

export function normalizeAlias(item: Alias): Alias {
  const root = resolve(item.root);

  return {
    root,
    aliases: [...new Set(item.aliases.map((alias) => resolve(alias)))].filter(
      (alias) => alias !== root && !isInsideRoot({ root, path: alias }),
    ),
  };
}
