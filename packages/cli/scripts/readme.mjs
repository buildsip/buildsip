import { copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// Publish the repo's canonical docs from the nested CLI package, then remove the copies.
for (const name of ["README.md", "LICENSE.md"]) {
  const target = join(process.cwd(), name);
  if (process.argv[2] === "copy") {
    copyFileSync(join(process.cwd(), "..", "..", name), target);
  } else if (process.argv[2] === "clean") {
    rmSync(target, { force: true });
  } else {
    throw new Error('Expected "copy" or "clean".');
  }
}
