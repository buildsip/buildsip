import { getAncestors } from "./get-ancestors";
import { lstatIfExists } from "./lstat-if-exists";

/**
 * Rejects paths outside `base` and symbolic links from `base` through `path`.
 * `base` is the first directory inspected; it need not be a repository root.
 * Missing entries are allowed. Ancestors above `base` are not inspected, so callers
 * should pass a base resolved with realpath. This check does not lock paths against later changes.
 */
export async function assertNoSymlinks({ path, base }: { path: string; base: string }) {
  for (const part of getAncestors({ path, root: base }).reverse()) {
    // lstat inspects the link itself; stat would follow it and hide that it was a link.
    const info = await lstatIfExists({ path: part });
    if (info?.isSymbolicLink()) {
      throw new Error(`Symbolic links are not supported: ${part}`);
    }
  }
}
