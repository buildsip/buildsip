import { relative, sep } from "node:path";

/**
 * Solve the relative path from {from} to {to} based on the current working directory.
 * 
 * Formats a native relative path with forward slashes, returning "" for equal paths.
 * On Unix, backslashes are filename characters and are preserved.
 * Like node:path.relative, paths on different Windows drives produce an absolute path.
 */
export function relativePosix({ from, to }: { from: string; to: string }): string {
  return relative(from, to).split(sep).join("/");
}
