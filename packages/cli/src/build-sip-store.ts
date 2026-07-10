import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { findBuildSipHomeDir } from "@buildsip/cli-auth";
import { findProjectRoot } from "./find-project-root";

export function buildSipStoreFromRoot(root: string) {
  const rootHash = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 16);
  const storeDir = join(findBuildSipHomeDir(), "projects", rootHash);

  return {
    logsDir: join(storeDir, "logs"),
    errorsPath: join(storeDir, "errors.jsonl"),
  };
}

/**
 * Returns BuildSip's local store paths for logs recorded by hooks and errors.
 */
export async function findBuildSipStore() {
  return buildSipStoreFromRoot(await findProjectRoot(process.cwd()));
}
