import { isAbsolute, relative, sep } from "node:path";

export function isInsideRoot(input: { path: string; root: string }) {
  const relativePath = relative(input.root, input.path);

  return (
    relativePath.length > 0 &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}
