import { copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const packageReadme = join(process.cwd(), "README.md");

if (process.argv[2] === "copy") {
  copyFileSync(join(process.cwd(), "..", "..", "README.md"), packageReadme);
} else if (process.argv[2] === "clean") {
  rmSync(packageReadme, { force: true });
} else {
  throw new Error('Expected "copy" or "clean".');
}
