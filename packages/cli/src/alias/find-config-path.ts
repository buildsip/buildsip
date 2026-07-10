import { join } from "node:path";
import { findBuildSipHomeDir } from "@buildsip/cli-auth";

export function findConfigPath() {
  return join(findBuildSipHomeDir(), "config.json");
}
