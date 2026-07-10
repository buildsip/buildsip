import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeAlias } from "./normalize-alias";
import { findConfigPath } from "./find-config-path";
import type { BuildSipConfig } from "./types";

export async function writeConfig(config: BuildSipConfig, configPath = findConfigPath()) {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        projects: config.projects.map(normalizeAlias).filter((entry) => entry.aliases.length > 0),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}
