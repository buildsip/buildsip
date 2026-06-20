import { homedir } from "node:os";
import { join } from "node:path";

export function findBuildSipHomeDir() {
  return join(homedir(), ".buildsip");
}
