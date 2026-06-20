import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function findPackageRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}
