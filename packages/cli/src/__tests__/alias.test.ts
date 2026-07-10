import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addAlias,
  findAliases,
  readConfig,
  removeAlias,
  writeConfig,
  type BuildSipConfig,
} from "../alias";

describe("BuildSip aliases", () => {
  it("adds aliases as resolved absolute paths and ignores duplicates", () => {
    const root = resolve("/workspace/project");
    const alias = resolve("/workspace/old-project");
    const first = addAlias({ config: { projects: [] }, root, alias });
    const second = addAlias({ config: first.config, root, alias });

    expect(first.added).toBe(true);
    expect(second.added).toBe(false);
    expect(second.config).toEqual({
      projects: [{ root, aliases: [alias] }],
    });
  });

  it("rejects self aliases", () => {
    const root = resolve("/workspace/project");

    expect(() => addAlias({ config: { projects: [] }, root, alias: root })).toThrow(
      "A root cannot alias itself.",
    );
  });

  it("rejects aliases inside the current root", () => {
    const root = resolve("/workspace/project");
    const alias = resolve("/workspace/project/frontend");

    expect(() => addAlias({ config: { projects: [] }, root, alias })).toThrow(
      "An alias cannot be inside the current root.",
    );
  });

  it("removes aliases and reports missing aliases", () => {
    const root = resolve("/workspace/project");
    const alias = resolve("/workspace/old-project");
    const config: BuildSipConfig = { projects: [{ root, aliases: [alias] }] };

    const removed = removeAlias({ config, root, alias });
    const missing = removeAlias({ config: removed.config, root, alias });

    expect(removed.removed).toBe(true);
    expect(removed.config).toEqual({ projects: [] });
    expect(missing.removed).toBe(false);
  });

  it("writes and reads config.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "buildsip-alias-"));
    const configPath = join(dir, "config.json");
    const root = resolve("/workspace/project");
    const alias = resolve("/workspace/old-project");

    await writeConfig({ projects: [{ root, aliases: [alias] }] }, configPath);

    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      projects: [{ root, aliases: [alias] }],
    });
    expect(findAliases({ config: await readConfig(configPath), root })).toEqual([alias]);
  });
});
