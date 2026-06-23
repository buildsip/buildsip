import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { findProjectRoot } from "./find-project-root";
import { findBuildSipHomeDir } from "@buildsip/cli-auth";

export async function findProjectStore() {
  const projectRoot = await findProjectRoot(process.cwd());
  const projectId = createHash("sha256").update(resolve(projectRoot)).digest("hex").slice(0, 16);
  const homeDir = findBuildSipHomeDir();
  const projectDir = join(homeDir, "projects", projectId);

  return {
    projectRoot,
    projectId,
    projectDir,
    logsDir: join(projectDir, "logs"),
    errorsPath: join(projectDir, "errors.jsonl"),
  };
}
