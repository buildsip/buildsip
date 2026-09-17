import { isAbsolute, relative, sep } from "node:path";

/**
 * Returns whether `path` is `parent` or sits under `parent`.
 * Compares path segments, not a string prefix, so `/repo-other` is not inside `/repo`.
 * Uses the current platform's path rules without reading the filesystem or following links.
 */
export function isInside({ path, parent }: { path: string; parent: string }) {
  // Walk from parent to path: "" means the same folder, "src/commands" means a child.
  const distance = relative(parent, path);
  // Another Windows drive stays absolute. ".." is the parent folder. "../x" is a sibling or cousin.
  return !isAbsolute(distance) && distance !== ".." && !distance.startsWith(`..${sep}`);
}
