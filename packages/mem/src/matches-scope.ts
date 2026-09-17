/**
 * Checks whether a literal {path} equals a {scope} or sits beneath it.
 * The special scopes * and . include every path.
 */
export function matchesScope({ scope, path }: { scope: string; path: string }) {
  // Require the slash boundary: apps/web must not match apps/web-old.
  // No filesystem lookup is needed, so this also works for paths not created yet.
  return scope === "*" || scope === "." || path === scope || path.startsWith(`${scope}/`);
}
