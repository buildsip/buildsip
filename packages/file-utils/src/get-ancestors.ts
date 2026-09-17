import { dirname, parse, relative, resolve } from "node:path";
import { isInside } from "./is-inside";

/**
 * Returns absolute paths from `path` up to `root`, including both ends.
 * Defaults to the filesystem root. Paths need not exist or refer to directories.
 *
 * If `path` is not inside `root`, it throws.
 */
export function getAncestors({ path, root }: { path: string; root?: string }): string[] {
  const start = resolve(path);
  const stop = root === undefined ? parse(start).root : resolve(root);
  if (!isInside({ path: start, parent: stop })) {
    throw new Error(`Path is outside ${stop}: ${path}`);
  }
  const paths: string[] = [];
  // dirname removes the last segment each time; this walk does not read the filesystem.
  for (let current = start; ; current = dirname(current)) {
    paths.push(current);
    // relative also recognizes equivalent path casing on Windows.
    if (relative(stop, current) === "") return paths;
  }
}
