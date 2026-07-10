import { readFile } from "node:fs/promises";
import z from "zod";
import { findConfigPath } from "./find-config-path";
import { normalizeAlias } from "./normalize-alias";
import type { BuildSipConfig } from "./types";

export async function readConfig(configPath = findConfigPath()): Promise<BuildSipConfig> {
  let content: string;

  try {
    content = await readFile(configPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { projects: [] };
    }

    throw error;
  }

  let raw: unknown;

  try {
    raw = JSON.parse(content) as unknown;
  } catch {
    throw new Error("BuildSip config is invalid.");
  }

  const result = z
    .object({
      projects: z
        .array(
          z.object({
            root: z.string().min(1),
            aliases: z.array(z.string().min(1)),
          }),
        )
        .default([]),
    })
    .safeParse(raw);

  if (!result.success) {
    throw new Error("BuildSip config is invalid.");
  }

  return {
    projects: result.data.projects.map(normalizeAlias).filter((entry) => entry.aliases.length > 0),
  };
}
