import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { NAMES } from "./names";
import { readConfig } from "./read-config";

let repo: string;
let project: string;
beforeEach(async () => {
  repo = await realpath(await mkdtemp(join(tmpdir(), "mem-config-")));
  project = join(repo, "package");
  await mkdir(join(project, NAMES.MEMORIES), { recursive: true });
  await mkdir(join(repo, NAMES.MEMORIES));
});
afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

it.each([
  { value: {}, expected: undefined },
  { value: { prune: false }, expected: false },
  { value: { prune: {} }, expected: {} },
  { value: { prune: { ttl: "120d" } }, expected: { ttl: "120d" } },
])("reads pruning settings $value without modifying the file", async ({ value, expected }) => {
  const path = join(project, NAMES.MEMORIES, NAMES.CONFIG_JSON);
  const source = JSON.stringify(value);
  await writeFile(path, source);
  const result = await readConfig({ project, repo });
  expect(result.config.prune).toEqual(expected);
  expect(result.source).toBe(source);
  expect(await readFile(path, "utf8")).toBe(source);
});

it("inherits an omitted prune field and lets explicit false disable a parent's object", async () => {
  await writeFile(
    join(repo, NAMES.MEMORIES, NAMES.CONFIG_JSON),
    JSON.stringify({ prune: { ttl: "120d", humanUpvoteAdds: "200d" } }),
  );
  await writeFile(join(project, NAMES.MEMORIES, NAMES.CONFIG_JSON), "{}");
  expect((await readConfig({ project, repo })).config.prune).toEqual({
    ttl: "120d",
    humanUpvoteAdds: "200d",
  });
  await writeFile(join(project, NAMES.MEMORIES, NAMES.CONFIG_JSON), '{"prune":false}');
  expect((await readConfig({ project, repo })).config.prune).toBe(false);
  await writeFile(join(project, NAMES.MEMORIES, NAMES.CONFIG_JSON), '{"prune":{"ttl":"150d"}}');
  expect((await readConfig({ project, repo })).config.prune).toEqual({
    ttl: "150d",
    humanUpvoteAdds: "200d",
  });
});

it.each([true, null, "false", { ttl: 90 }, { enabled: "no" }])(
  "rejects invalid prune value %j",
  async (prune) => {
    await writeFile(join(project, NAMES.MEMORIES, NAMES.CONFIG_JSON), JSON.stringify({ prune }));
    await expect(readConfig({ project, repo })).rejects.toThrow("Invalid config");
  },
);

it("rejects unknown config keys", async () => {
  await writeFile(
    join(project, NAMES.MEMORIES, NAMES.CONFIG_JSON),
    JSON.stringify({ banana: true }),
  );
  await expect(readConfig({ project, repo })).rejects.toThrow("Invalid config");
});

it.each([
  { value: undefined, availableToWorkspace: false },
  { value: {}, availableToWorkspace: false },
  { value: { availableToWorkspace: false }, availableToWorkspace: false },
  { value: { availableToWorkspace: true }, availableToWorkspace: true },
])(
  "uses only the root availableToWorkspace setting: $value",
  async ({ value, availableToWorkspace }) => {
    if (value !== undefined)
      await writeFile(join(repo, NAMES.MEMORIES, NAMES.CONFIG_JSON), JSON.stringify(value));
    await writeFile(join(project, NAMES.MEMORIES, NAMES.CONFIG_JSON), '{"prune":false}');
    expect((await readConfig({ project: repo, repo })).availableToWorkspace).toBe(
      availableToWorkspace,
    );
    const child = await readConfig({ project, repo });
    expect(child.availableToWorkspace).toBe(availableToWorkspace);
    expect(child.local).not.toHaveProperty("availableToWorkspace");
  },
);

it.each([
  { root: {}, child: true },
  { root: { availableToWorkspace: false }, child: true },
  { root: { availableToWorkspace: true }, child: false },
  { root: { availableToWorkspace: true }, child: true },
  { root: {}, child: false },
])("rejects child sharing $child with root $root", async ({ root, child }) => {
  const path = join(project, NAMES.MEMORIES, NAMES.CONFIG_JSON);
  const source = JSON.stringify({ availableToWorkspace: child });
  await writeFile(join(repo, NAMES.MEMORIES, NAMES.CONFIG_JSON), JSON.stringify(root));
  await writeFile(path, source);
  const nested = join(project, "nested");
  await mkdir(nested);
  for (const directory of [project, nested]) {
    await expect(readConfig({ project: directory, repo })).rejects.toThrow(
      `Remove availableToWorkspace from ${path}. Set it only in the repository root config: ${join(repo, NAMES.MEMORIES, NAMES.CONFIG_JSON)}`,
    );
  }
  expect(await readFile(path, "utf8")).toBe(source);
});

it.each([false, true])(
  "identifies the removed requireScope option (%s) as an unknown field",
  async (value) => {
    const path = join(repo, NAMES.MEMORIES, NAMES.CONFIG_JSON);
    await writeFile(path, JSON.stringify({ frontmatter: { requireScope: value } }));
    await expect(readConfig({ project, repo })).rejects.toThrow(
      /Remove this unknown field. Only custom[^\n]*\n  → at frontmatter.requireScope/,
    );
  },
);

it.each([false, true])(
  "identifies the removed prune.enabled option (%s) as an unknown field",
  async (value) => {
    const path = join(repo, NAMES.MEMORIES, NAMES.CONFIG_JSON);
    await writeFile(path, JSON.stringify({ prune: { enabled: value, ttl: "90d" } }));
    await expect(readConfig({ project, repo })).rejects.toThrow(
      /Remove this unknown field. Allowed pruning fields[^\n]*\n  → at prune.enabled/,
    );
  },
);

it.each([
  { value: { version: 2 }, field: "version", expected: "Expected the number 1" },
  {
    value: { availableToWorkspace: "true" },
    field: "availableToWorkspace",
    expected: "Expected a boolean: true",
  },
  {
    value: { prune: { ttl: 90 } },
    field: "prune.ttl",
    expected: 'Expected a nonempty duration string, such as "90d"',
  },
  {
    value: { prune: { humanUpvoteAdds: [] } },
    field: "prune.humanUpvoteAdds",
    expected: "duration string",
  },
  {
    value: { prune: { agentUpvoteAdds: "" } },
    field: "prune.agentUpvoteAdds",
    expected: "duration string",
  },
  { value: { prune: { typo: 1 } }, field: "prune.typo", expected: "Allowed pruning fields" },
  {
    value: { frontmatter: { custom: [] } },
    field: "frontmatter.custom",
    expected: "Expected a JSON Schema object",
  },
  { value: { frontmatter: { typo: {} } }, field: "frontmatter.typo", expected: "Only custom" },
  { value: { typo: true }, field: "typo", expected: "Allowed config fields" },
])("explains the expected value for $field", async ({ value, field, expected }) => {
  const path = join(repo, NAMES.MEMORIES, NAMES.CONFIG_JSON);
  await writeFile(path, JSON.stringify(value));
  const error = await readConfig({ project, repo }).catch((error: Error) => error);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain(path);
  expect((error as Error).message).toContain(`→ at ${field}`);
  expect((error as Error).message).toContain(expected);
});

it("includes the config file and JSON syntax guidance for malformed JSON", async () => {
  const path = join(repo, NAMES.MEMORIES, NAMES.CONFIG_JSON);
  await writeFile(path, '{"prune":');
  await expect(readConfig({ project, repo })).rejects.toThrow(
    `Invalid config ${path}: expected one valid JSON object with double-quoted keys`,
  );
});

it("inherits the root schema unchanged through package pruning overrides", async () => {
  const custom = {
    $defs: { ticket: { type: "string", pattern: "^ENG-" } },
    properties: {
      ticket: { $ref: "#/$defs/ticket" },
      items: { type: "array", items: { enum: ["a", "b"] } },
    },
    required: ["ticket"],
    additionalProperties: false,
  };
  await writeFile(
    join(repo, NAMES.MEMORIES, NAMES.CONFIG_JSON),
    JSON.stringify({ frontmatter: { custom }, prune: { ttl: "90d", humanUpvoteAdds: "180d" } }),
  );
  const path = join(project, NAMES.MEMORIES, NAMES.CONFIG_JSON);
  const source = JSON.stringify({ frontmatter: {}, prune: { ttl: "120d" } });
  await writeFile(path, source);
  const nested = join(project, "nested");
  await mkdir(nested);
  expect((await readConfig({ project: repo, repo })).config.frontmatter?.custom).toEqual(custom);
  for (const directory of [project, nested]) {
    const result = await readConfig({ project: directory, repo });
    expect(result.config.frontmatter?.custom).toEqual(custom);
    expect(result.config.prune).toEqual({ ttl: "120d", humanUpvoteAdds: "180d" });
    expect(result.local).not.toHaveProperty("frontmatter.custom");
  }
  expect(await readFile(path, "utf8")).toBe(source);
});

it.each([
  { root: undefined, child: {} },
  { root: undefined, child: { properties: { ticket: { type: "string" } } } },
  { root: { required: ["ticket"] }, child: {} },
  { root: { required: ["ticket"] }, child: { required: ["runbook"] } },
])("rejects a child schema $child with root schema $root", async ({ root, child }) => {
  const config = join(repo, NAMES.MEMORIES, NAMES.CONFIG_JSON);
  if (root !== undefined)
    await writeFile(config, JSON.stringify({ frontmatter: { custom: root } }));
  const path = join(project, NAMES.MEMORIES, NAMES.CONFIG_JSON);
  const source = JSON.stringify({ frontmatter: { custom: child } });
  await writeFile(path, source);
  const nested = join(project, "nested");
  await mkdir(nested);
  for (const directory of [project, nested]) {
    await expect(readConfig({ project: directory, repo })).rejects.toThrow(
      `Remove frontmatter.custom from ${path}. Define it only in the repository root config: ${config}.`,
    );
  }
  expect(await readFile(path, "utf8")).toBe(source);
  if (root === undefined) await expect(readFile(config)).rejects.toMatchObject({ code: "ENOENT" });
});
