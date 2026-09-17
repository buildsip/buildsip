import { getAncestors } from "./get-ancestors";

/**
 * Returns the nearest absolute path accepted by `test`, or undefined if none match.
 * Tests `path` first and `root` last; omitted roots default to the filesystem root.
 * The predicate decides what exists or matches, and its errors propagate unchanged.
 */
export async function findUp({
  path,
  root,
  test,
}: {
  path: string;
  root?: string;
  test: (path: string) => boolean | Promise<boolean>;
}): Promise<string | undefined> {
  for (const parent of getAncestors({ path, root })) {
    if (await test(parent)) return parent;
  }
  return undefined;
}
