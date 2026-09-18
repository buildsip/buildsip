import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";
import { deleteMemories } from "./commands/delete-memories";
import { search } from "./commands/search";
import { insert } from "./commands/insert";
import { update } from "./commands/update";
import { NAMES } from "./names";
import { cliEnv } from "./test/cli-env";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, rename: vi.fn(original.rename) };
});

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
let temp: string;
let root: string;
let web: string;
let api: string;
let team: string;
let roots: string[];

beforeEach(async () => {
  vi.mocked(rename).mockReset();
  const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(rename).mockImplementation(fs.rename);
  temp = await realpath(await mkdtemp(join(tmpdir(), "mem-commands-")));
  // CLI startup installs MCP entries. Use a detected agent in a disposable home.
  await mkdir(join(temp, "home", ".cursor"), { recursive: true });
  root = join(temp, "project with spaces");
  team = join(temp, "team");
  web = join(root, "apps", "web");
  api = join(root, "apps", "api");
  roots = [root, team];
  for (const path of [root, team, web, api]) {
    await mkdir(path, { recursive: true });
    await writeFile(join(path, NAMES.PACKAGE_JSON), "{}");
  }
  await mkdir(join(web, "auth"));
  for (const repo of roots) execFileSync("git", ["init", "--quiet", repo]);
});

afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

async function config({ project, value }: { project: string; value: Record<string, unknown> }) {
  await mkdir(join(project, NAMES.MEMORIES), { recursive: true });
  await writeFile(join(project, NAMES.MEMORIES, NAMES.CONFIG_JSON), JSON.stringify(value));
}

async function memory({
  project = root,
  title,
  body = "remember this detail",
  scope,
  ...fields
}: {
  project?: string;
  title: string;
  body?: string;
  scope?: string[];
  doNotEdit?: boolean;
  doNotDelete?: boolean;
  [key: string]: unknown;
}) {
  const repo = project === team || project.startsWith(`${team}/`) ? team : root;
  const [path] = await insert({
    roots,
    repo,
    body,
    frontmatter: {
      title,
      scope: scope ?? [relative(repo, project) || "*"],
      ...fields,
    },
  });
  return path!;
}

async function edit({
  path,
  body,
  ...fields
}: {
  path: string;
  body?: string;
  title?: string;
  scope?: string[];
  doNotEdit?: boolean;
  doNotDelete?: boolean;
  [key: string]: unknown;
}) {
  const [saved] = await update({ roots, repo: root, path, body, frontmatter: fields });
  return saved!;
}

async function frontmatter(path: string) {
  const source = await readFile(path, "utf8");
  return parse(source.split("---")[1]!);
}

function run({ args, input }: { args: string[]; input?: string }) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    input,
    encoding: "utf8",
    env: cliEnv({ home: join(temp, "home") }),
  });
}

describe("insert and update", () => {
  it("moves a root memory into a package when its scope narrows", async () => {
    const old = await memory({ title: "Legacy memory" });
    const id = (await frontmatter(old)).id;
    const path = await edit({ path: old, title: "Legacy memory", scope: ["apps/web"] });
    expect(path).toBe(join(web, NAMES.MEMORIES, NAMES.DATA, "legacy-memory", NAMES.MEMORY_MD));
    expect(existsSync(old)).toBe(false);
    expect(await frontmatter(path)).toMatchObject({ id });
    expect(await frontmatter(path)).not.toHaveProperty("scope");
  });

  it("validates standard JSON Schema formats", async () => {
    await config({
      project: root,
      value: {
        frontmatter: {
          custom: { properties: { link: { type: "string", format: "uri" } }, required: ["link"] },
        },
      },
    });
    await expect(memory({ title: "Invalid URL", link: "not a URL" })).rejects.toThrow(
      "custom frontmatter",
    );
    expect(await memory({ title: "Valid URL", link: "https://example.com" })).toContain(
      NAMES.MEMORY_MD,
    );
  });

  it("rolls back a title rename if replacing the body fails", async () => {
    const path = await memory({ title: "Before" });
    const before = await readFile(path, "utf8");
    const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(from).endsWith(NAMES.MEMORY_MD)) throw new Error("disk full");
      return fs.rename(from, to);
    });
    await expect(edit({ path, title: "After", body: "changed" })).rejects.toThrow("disk full");
    expect(await readFile(path, "utf8")).toBe(before);
    expect(existsSync(join(root, NAMES.MEMORIES, NAMES.DATA, "after"))).toBe(false);
  });
  it("creates a title-named memory with a stable UUID in a package on demand", async () => {
    const path = await memory({
      project: web,
      title: "Déjà vu: cache",
      body: "Do not parse --- in Markdown.\n",
    });
    expect(path).toBe(join(web, NAMES.MEMORIES, NAMES.DATA, "deja-vu-cache", NAMES.MEMORY_MD));
    expect((await frontmatter(path)).id).toMatch(/^[0-9a-f-]{36}$/);
    expect(existsSync(join(root, NAMES.MEMORIES))).toBe(false);
    expect((await search({ roots, repo: root, query: "parse" }))[0]?.body).toBe(
      "Do not parse --- in Markdown.\n",
    );
  });

  it("updates by path, renames the folder, and preserves attachments and omitted metadata", async () => {
    const old = await memory({ title: "Old title", scope: ["apps/web/auth"], doNotDelete: true });
    const id = (await frontmatter(old)).id;
    await writeFile(join(dirname(old), "evidence.json"), '{"keep":true}');
    const path = await edit({
      path: old,
      title: "New title",
      body: "new body",
      scope: ["apps/web/auth"],
    });
    expect(existsSync(old)).toBe(false);
    expect(await readFile(join(dirname(path), "evidence.json"), "utf8")).toBe('{"keep":true}');
    expect(await frontmatter(path)).toMatchObject({
      id,
      title: "New title",
      scope: ["apps/web/auth"],
      doNotDelete: true,
    });
  });

  it("preserves directory tags on a title rename", async () => {
    const first = await memory({ title: "Cache warning" });
    await mkdir(join(root, NAMES.MEMORIES, NAMES.DATA, "errors"));
    const tagged = join(root, NAMES.MEMORIES, NAMES.DATA, "errors", "cache-warning");
    await rename(dirname(first), tagged);
    const path = await edit({
      path: join(tagged, NAMES.MEMORY_MD),
      title: "Updated cache warning",
    });
    expect(path).toBe(
      join(root, NAMES.MEMORIES, NAMES.DATA, "errors", "updated-cache-warning", NAMES.MEMORY_MD),
    );
    expect(await search({ roots, repo: root, query: "errors" })).toHaveLength(1);
  });

  it("rejects title collisions without overwriting either memory", async () => {
    const one = await memory({ title: "One" });
    const two = await memory({ title: "Two" });
    const before = await readFile(one, "utf8");
    await expect(edit({ path: two, title: "One" })).rejects.toThrow("already exists");
    await expect(memory({ title: "One" })).rejects.toThrow("already exists");
    expect(await readFile(one, "utf8")).toBe(before);
    expect(existsSync(two)).toBe(true);
  });

  it("rejects edits to a protected memory even when the call tries to clear protection", async () => {
    const path = await memory({ title: "Protected", doNotEdit: true });
    const before = await readFile(path, "utf8");
    await expect(edit({ path, title: "Changed", doNotEdit: false })).rejects.toThrow(
      `You cannot edit this memory because doNotEdit is true: ${path}. Ask the user to edit it.`,
    );
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("moves between packages and preserves attachment folders and directory tags", async () => {
    const first = await memory({ project: api, title: "Cache rule", doNotDelete: true });
    const tags = join(api, NAMES.MEMORIES, NAMES.DATA, "errors", "network");
    await mkdir(tags, { recursive: true });
    const old = join(tags, "cache-rule", NAMES.MEMORY_MD);
    await rename(dirname(first), dirname(old));
    await mkdir(join(dirname(old), "attachments"));
    await writeFile(join(dirname(old), "attachments", "trace.txt"), "trace");
    const id = (await frontmatter(old)).id;
    const path = await edit({ path: old, title: "Updated rule", scope: ["apps/web/auth"] });
    expect(path).toBe(
      join(web, NAMES.MEMORIES, NAMES.DATA, "errors", "network", "updated-rule", NAMES.MEMORY_MD),
    );
    expect(await frontmatter(path)).toMatchObject({
      id,
      scope: ["apps/web/auth"],
      doNotDelete: true,
    });
    expect(await readFile(join(dirname(path), "attachments", "trace.txt"), "utf8")).toBe("trace");
    expect(existsSync(old)).toBe(false);
  });

  it("rolls back a store move if publishing the new body fails", async () => {
    const old = await memory({ project: web, title: "Before" });
    const before = await readFile(old, "utf8");
    await writeFile(join(dirname(old), "trace.txt"), "keep");
    const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(from).endsWith(NAMES.MEMORY_MD)) throw new Error("disk full");
      return fs.rename(from, to);
    });
    await expect(edit({ path: old, title: "After", scope: ["apps/api"] })).rejects.toThrow(
      "disk full",
    );
    expect(await readFile(old, "utf8")).toBe(before);
    expect(await readFile(join(dirname(old), "trace.txt"), "utf8")).toBe("keep");
    expect(existsSync(join(api, NAMES.MEMORIES, NAMES.DATA, "after"))).toBe(false);
  });

  it("places sibling package scopes at their common repo root", async () => {
    const path = await memory({ title: "Shared cache", scope: ["apps/web", "apps/api"] });
    expect(path).toBe(join(root, NAMES.MEMORIES, NAMES.DATA, "shared-cache", NAMES.MEMORY_MD));
    expect((await frontmatter(path)).scope).toEqual(["apps/web", "apps/api"]);
    for (const scope of ["apps/web", "apps/api"])
      expect(
        (await search({ roots, repo: root, query: "cache", scope: [scope] })).map(
          (entry) => entry.path,
        ),
      ).toEqual([path]);
  });

  it("places file and directory scopes in the nearest common package without prior init", async () => {
    await mkdir(join(web, "src", "commands"), { recursive: true });
    await writeFile(join(web, "src", "constants.ts"), "");
    const scopes = ["apps/web/src/commands", "apps/web/src/constants.ts"];
    const path = await memory({ title: "CLI internals", scope: scopes });
    expect(path).toBe(join(web, NAMES.MEMORIES, NAMES.DATA, "cli-internals", NAMES.MEMORY_MD));
    expect((await frontmatter(path)).scope).toEqual(scopes);
    expect(existsSync(join(root, NAMES.MEMORIES))).toBe(false);
    expect(existsSync(join(web, "src", NAMES.MEMORIES))).toBe(false);
  });

  it("chooses a nested common package and keeps the broader scope when children are redundant", async () => {
    const nested = join(web, "plugins", "auth");
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, NAMES.PACKAGE_JSON), "{}");
    await mkdir(join(nested, "src"));
    await writeFile(join(nested, "src", "session.ts"), "");
    const path = await memory({
      title: "Auth",
      scope: ["apps/web/plugins/auth/src", "apps/web/plugins/auth/src/session.ts"],
    });
    expect(path).toContain(join(nested, NAMES.MEMORIES, NAMES.DATA));
    expect((await frontmatter(path)).scope).toEqual(["apps/web/plugins/auth/src"]);
  });

  it.each([
    { scopes: ["apps/web"], store: "web" },
    { scopes: ["apps/web/auth", "apps/web", "apps/web/"], store: "web" },
    { scopes: ["apps/web", "*"], store: "root" },
    { scopes: [".", "*"], store: "root" },
  ])(
    "omits scope when the owning $store directory expresses $scopes",
    async ({ scopes, store }) => {
      const path = await memory({ title: "Implicit scope", scope: scopes });
      expect(path).toContain(join(store === "web" ? web : root, NAMES.MEMORIES, NAMES.DATA));
      expect(await frontmatter(path)).not.toHaveProperty("scope");
    },
  );

  it("removes a previous explicit scope when an update covers the owning directory", async () => {
    const old = await memory({ title: "Auth", scope: ["apps/web/auth"] });
    const path = await edit({
      path: old,
      title: "Auth",
      scope: ["apps/web"],
    });
    expect(path).toBe(old);
    expect(await frontmatter(path)).not.toHaveProperty("scope");
    expect(
      await search({ roots, repo: root, query: "Auth", scope: ["apps/web/package.json"] }),
    ).toHaveLength(1);
  });

  it("widens a package memory to the repo when scope becomes *", async () => {
    const old = await memory({ title: "Cache", scope: ["apps/web/auth"] });
    const id = (await frontmatter(old)).id;
    await writeFile(join(dirname(old), "evidence.txt"), "keep");
    const path = await edit({ path: old, title: "Cache", scope: ["*"] });
    expect(path).toBe(join(root, NAMES.MEMORIES, NAMES.DATA, "cache", NAMES.MEMORY_MD));
    expect(await frontmatter(path)).toMatchObject({ id });
    expect(await frontmatter(path)).not.toHaveProperty("scope");
    expect(await readFile(join(dirname(path), "evidence.txt"), "utf8")).toBe("keep");
    expect(existsSync(old)).toBe(false);
    expect(await search({ roots, repo: root, query: "Cache", scope: ["apps/api"] })).toHaveLength(
      1,
    );
  });

  it("keeps a non-package directory scope at the repo instead of choosing one child", async () => {
    const path = await memory({ title: "All apps", scope: ["apps"] });
    expect(path).toContain(join(root, NAMES.MEMORIES, NAMES.DATA));
    expect((await frontmatter(path)).scope).toEqual(["apps"]);
    expect(existsSync(join(root, "apps", NAMES.MEMORIES))).toBe(false);
  });

  it("rejects root schema mismatches and destination collisions without touching the original", async () => {
    const old = await memory({ project: web, title: "Keep" });
    const before = await readFile(old, "utf8");
    await config({ project: root, value: { frontmatter: { custom: { required: ["ticket"] } } } });
    await expect(edit({ path: old, title: "Moved", scope: ["apps/api"] })).rejects.toThrow(
      "custom frontmatter",
    );
    expect(await readFile(old, "utf8")).toBe(before);
    await config({ project: root, value: {} });
    const collision = await memory({ project: api, title: "Keep" });
    await expect(edit({ path: old, title: "Keep", scope: ["apps/api"] })).rejects.toThrow(
      "already exists",
    );
    expect(await readFile(old, "utf8")).toBe(before);
    expect(existsSync(collision)).toBe(true);
  });

  it("does not relocate protected memories when scope changes", async () => {
    const old = await memory({ project: web, title: "Protected", doNotEdit: true });
    await expect(edit({ path: old, title: "Protected", scope: ["apps/api"] })).rejects.toThrow(
      `You cannot edit this memory because doNotEdit is true: ${old}. Ask the user to edit it.`,
    );
    expect(existsSync(old)).toBe(true);
    expect(existsSync(join(api, NAMES.MEMORIES))).toBe(false);
  });

  it("rejects scopes in a nested Git repository", async () => {
    execFileSync("git", ["init", "--quiet", web]);
    await expect(
      insert({
        roots,
        repo: root,
        body: "body",
        frontmatter: { title: "Wrong repo", scope: ["apps/web"] },
      }),
    ).rejects.toThrow("different Git repository");
  });

  it.each([
    ["bad/bad/bad"],
    ["apps/web/missing.ts"],
    ["apps/web/package.json/child"],
    ["apps/web", "bad/bad/bad"],
    ["*", "bad/bad/bad"],
  ])("rejects missing scopes %j before creating or updating any files", async (...scope) => {
    await expect(memory({ title: "Invalid placement", scope })).rejects.toThrow(
      "existing repository-relative file or directory",
    );
    for (const project of [root, web, api]) {
      expect(existsSync(join(project, NAMES.MEMORIES))).toBe(false);
    }
    const path = await memory({ project: api, title: "Keep" });
    const before = await readFile(path, "utf8");
    await writeFile(join(dirname(path), "trace.txt"), "keep attachment");
    await expect(edit({ path, title: "Changed", body: "changed", scope })).rejects.toThrow(
      "existing repository-relative file or directory",
    );
    expect(await readFile(path, "utf8")).toBe(before);
    expect(await readFile(join(dirname(path), "trace.txt"), "utf8")).toBe("keep attachment");
    expect(existsSync(join(root, NAMES.MEMORIES))).toBe(false);
    expect(existsSync(join(web, NAMES.MEMORIES))).toBe(false);
    await expect(search({ roots, repo: root, query: "Keep", scope })).rejects.toThrow(
      "existing repository-relative file or directory",
    );
  });

  it("rejects existing scopes outside the repo, symlinks, and nested repos on update and search", async () => {
    const path = await memory({ title: "Keep" });
    const before = await readFile(path, "utf8");
    await symlink(team, join(root, "outside"), "dir");
    await symlink(web, join(root, "alias"), "dir");
    execFileSync("git", ["init", "--quiet", api]);
    for (const scope of [team, "../team", "outside", "alias/auth", "apps/api"]) {
      await expect(memory({ title: "Bad", scope: [scope] })).rejects.toThrow();
      await expect(edit({ path, scope: [scope] })).rejects.toThrow();
      await expect(search({ roots, repo: root, query: "Keep", scope: [scope] })).rejects.toThrow();
      expect(await readFile(path, "utf8")).toBe(before);
    }
  });

  it("rejects symlinked scope paths", async () => {
    const link = join(root, "linked-package");
    await symlink(web, link, "dir");
    await expect(
      insert({
        roots,
        repo: root,
        body: "body",
        frontmatter: { title: "Linked", scope: ["linked-package"] },
      }),
    ).rejects.toThrow("Symbolic links");
  });

  it("selects the exact path even if another memory has the same ID", async () => {
    const path = await memory({ title: "First" });
    const second = join(root, NAMES.MEMORIES, NAMES.DATA, "second", NAMES.MEMORY_MD);
    await mkdir(dirname(second));
    await writeFile(second, await readFile(path));
    const before = await readFile(second, "utf8");
    await edit({ path, body: "changed first" });
    expect(await readFile(second, "utf8")).toBe(before);
    expect(await readFile(path, "utf8")).toContain("changed first");
  });

  it("uses one root schema for inserts and moves across package and repo stores", async () => {
    await config({
      project: root,
      value: {
        version: 1,
        frontmatter: {
          custom: {
            properties: {
              ticket: { type: "string", minLength: 3 },
              anchors: { type: "array", items: { type: "string" } },
            },
            required: ["ticket"],
            additionalProperties: false,
          },
        },
      },
    });
    await config({
      project: web,
      value: { prune: { ttl: "120d" } },
    });
    for (const project of [root, web, api]) {
      await expect(memory({ project, title: "Bad ticket", ticket: "AB" })).rejects.toThrow(
        "custom frontmatter",
      );
      await expect(memory({ project, title: "Missing ticket" })).rejects.toThrow(
        "frontmatter.ticket",
      );
    }
    let path = await memory({
      project: web,
      title: "Valid rule",
      scope: ["apps/web"],
      ticket: "ABC",
      anchors: ["cache"],
    });
    expect(await frontmatter(path)).toMatchObject({ ticket: "ABC", anchors: ["cache"] });
    const id = (await frontmatter(path)).id;
    for (const project of [api, root]) {
      const previous = path;
      path = await edit({ path, scope: [relative(root, project) || "*"] });
      expect(path).toBe(join(project, NAMES.MEMORIES, NAMES.DATA, "valid-rule", NAMES.MEMORY_MD));
      expect(existsSync(previous)).toBe(false);
      expect(await frontmatter(path)).toMatchObject({ id, ticket: "ABC", anchors: ["cache"] });
      const before = await readFile(path, "utf8");
      await expect(edit({ path, ticket: "AB" })).rejects.toThrow("custom frontmatter");
      expect(await readFile(path, "utf8")).toBe(before);
    }
    expect(await search({ roots, repo: root, query: "ABC" })).toHaveLength(1);
  });

  it("loads memories with implicit scopes at both the repo and package roots", async () => {
    await memory({ title: "Cache root" });
    await memory({ project: web, title: "Cache web" });
    expect(await search({ roots, repo: root, query: "cache" })).toHaveLength(2);
    expect(await search({ roots, repo: root, query: "cache", scope: ["apps/api"] })).toHaveLength(
      1,
    );
  });

  it("rejects undeclared extra fields and a nested custom bag", async () => {
    await expect(memory({ title: "Bad", ticket: "x" })).rejects.toThrow("frontmatter.custom");
    await expect(memory({ title: "Bad", custom: { ticket: "x" } })).rejects.toThrow(
      "frontmatter.custom",
    );
    expect(existsSync(join(root, NAMES.MEMORIES))).toBe(false);
  });

  it.each(["../outside", "/absolute", "apps/../../outside", "!apps/web"])(
    "rejects unsafe scope %s",
    async (scope) => {
      await expect(memory({ title: "Bad scope", scope: [scope] })).rejects.toThrow(
        "repository-relative",
      );
    },
  );

  it("requires a workspace-contained Git root", async () => {
    await mkdir(join(web, "src"));
    await expect(
      insert({
        roots,
        repo: join(web, "src"),
        body: "body",
        frontmatter: { title: "Wrong root", scope: ["*"] },
      }),
    ).rejects.toThrow("Git root");
    await expect(
      insert({
        roots: [web],
        repo: api,
        body: "body",
        frontmatter: { title: "Outside root", scope: ["*"] },
      }),
    ).rejects.toThrow("workspace roots");
    await expect(
      insert({
        roots: [temp],
        repo: temp,
        body: "body",
        frontmatter: { title: "No git", scope: ["*"] },
      }),
    ).rejects.toThrow("Git working tree");
  });

  it("refuses a symlinked memory directory", async () => {
    const outside = join(temp, "outside");
    await mkdir(outside);
    await symlink(outside, join(root, NAMES.MEMORIES), "dir");
    await expect(memory({ title: "Escape" })).rejects.toThrow("Symbolic links");
    expect(existsSync(join(outside, NAMES.DATA))).toBe(false);
  });
});

describe("partial updates", () => {
  it.each(["", " ", "memory\0.md"])("rejects invalid target paths: %j", async (path) => {
    await expect(update({ roots, repo: root, path })).rejects.toThrow("Provide --path");
  });
  it.each(["path", "body", "same title"])(
    "repairs a mismatched folder on a %s update",
    async (change) => {
      const original = await memory({ project: web, title: "Déjà vu: cache", doNotDelete: true });
      const header = await frontmatter(original);
      const body = "  indented code\n\nkeep trailing spaces  \n\n";
      await writeFile(original, `---\n${stringify(header)}---\n\n${body}`);
      const tags = join(web, NAMES.MEMORIES, NAMES.DATA, "errors");
      await mkdir(tags);
      const wrong = join(tags, "wrong-folder", NAMES.MEMORY_MD);
      await rename(dirname(original), dirname(wrong));
      await writeFile(join(dirname(wrong), "trace.txt"), "keep attachment");
      const patch =
        change === "body"
          ? { body: "new content" }
          : change === "same title"
            ? { frontmatter: { title: header.title } }
            : {};
      const [saved] = await update({ roots, repo: root, path: wrong, ...patch });
      expect(saved).toBe(join(tags, "deja-vu-cache", NAMES.MEMORY_MD));
      expect(await frontmatter(saved!)).toEqual(header);
      expect((await search({ roots, repo: root, query: "cache" }))[0]?.body).toBe(
        change === "body" ? "new content\n" : body,
      );
      expect(await readFile(join(dirname(saved!), "trace.txt"), "utf8")).toBe("keep attachment");
      expect(existsSync(wrong)).toBe(false);
      await expect(update({ roots, repo: root, path: wrong })).rejects.toThrow("Search again");
    },
  );

  it("preserves explicit scope and current store when scope is omitted", async () => {
    const first = await memory({ title: "Scope", scope: ["apps/web/auth"] });
    // A manually relocated memory must not move stores again on a content-only update.
    const path = join(root, NAMES.MEMORIES, NAMES.DATA, "scope", NAMES.MEMORY_MD);
    await mkdir(dirname(dirname(path)), { recursive: true });
    await rename(dirname(first), dirname(path));
    const before = await frontmatter(path);
    expect(await update({ roots, repo: root, path, body: "new body" })).toEqual([path]);
    expect(await frontmatter(path)).toEqual(before);
    expect(existsSync(first)).toBe(false);
  });

  it("merges supplied custom fields, keeps omitted fields, and treats null as a value", async () => {
    await config({
      project: root,
      value: {
        frontmatter: {
          custom: {
            properties: {
              ticket: { type: ["string", "null"] },
              anchors: { type: "array", items: { type: "string" } },
            },
            required: ["ticket", "anchors"],
          },
        },
      },
    });
    const path = await memory({
      title: "Custom",
      ticket: "ENG-1",
      anchors: ["a", "b"],
      doNotDelete: true,
    });
    await update({ roots, repo: root, path, frontmatter: { ticket: null, doNotDelete: false } });
    expect(await frontmatter(path)).toMatchObject({
      ticket: null,
      anchors: ["a", "b"],
      doNotDelete: false,
    });
    const before = await readFile(path, "utf8");
    await expect(
      update({ roots, repo: root, path, frontmatter: { anchors: [42] } }),
    ).rejects.toThrow("frontmatter.anchors[0]");
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("accepts a folder path for a title-only update and keeps the body", async () => {
    const path = await memory({ title: "Old", body: "preserve body" });
    const id = (await frontmatter(path)).id;
    const [saved] = await update({
      roots,
      repo: root,
      path: dirname(path),
      frontmatter: { title: "New" },
    });
    expect(saved).toBe(join(root, NAMES.MEMORIES, NAMES.DATA, "new", NAMES.MEMORY_MD));
    expect(await frontmatter(saved!)).toMatchObject({ id, title: "New" });
    expect((await search({ roots, repo: root, query: "New" }))[0]?.body).toBe("preserve body\n");
  });

  it("does not overwrite another folder during self-healing", async () => {
    const path = await memory({ title: "Original" });
    const wrong = join(dirname(dirname(path)), "wrong", NAMES.MEMORY_MD);
    await rename(dirname(path), dirname(wrong));
    await memory({ title: "Original", body: "another memory" });
    const before = await readFile(wrong, "utf8");
    const other = await readFile(path, "utf8");
    await expect(update({ roots, repo: root, path: wrong })).rejects.toThrow("already exists");
    expect(await readFile(wrong, "utf8")).toBe(before);
    expect(await readFile(path, "utf8")).toBe(other);
  });

  it("repairs a case-only folder mismatch on case-sensitive and case-insensitive disks", async () => {
    const path = await memory({ title: "Cache" });
    const wrong = join(dirname(dirname(path)), "CACHE", NAMES.MEMORY_MD);
    await rename(dirname(path), dirname(wrong));
    expect(await update({ roots, repo: root, path: wrong })).toEqual([path]);
    expect(await realpath(path)).toBe(path);
  });

  it("protects path-only updates and folders containing other memories", async () => {
    const protectedPath = await memory({ title: "Protected", doNotEdit: true });
    await expect(update({ roots, repo: root, path: protectedPath })).rejects.toThrow("doNotEdit");
    const parent = await memory({ title: "Parent" });
    const child = await memory({ title: "Child" });
    await rename(dirname(child), join(dirname(parent), "child"));
    await expect(update({ roots, repo: root, path: parent })).rejects.toThrow("nested memories");
    expect(existsSync(join(dirname(parent), "child", NAMES.MEMORY_MD))).toBe(true);
  });

  it("rejects missing, foreign, non-memory, nested-repo, and symlink paths", async () => {
    const missing = join(root, NAMES.MEMORIES, NAMES.DATA, "missing", NAMES.MEMORY_MD);
    await expect(update({ roots, repo: root, path: missing })).rejects.toThrow("No memory exists");
    expect(existsSync(dirname(missing))).toBe(false);
    const foreign = await memory({ project: team, title: "Foreign" });
    await expect(update({ roots, repo: root, path: foreign })).rejects.toThrow();
    const path = await memory({ project: web, title: "Local" });
    const source = await readFile(path, "utf8");
    const stray = join(root, NAMES.MEMORY_MD);
    await writeFile(stray, source);
    await expect(update({ roots, repo: root, path: stray })).rejects.toThrow(
      "Choose a memory path",
    );
    await expect(
      update({ roots, repo: root, path: join(web, NAMES.PACKAGE_JSON) }),
    ).rejects.toThrow("existing memory.md");
    const link = join(root, "link");
    await symlink(dirname(path), link, "dir");
    await expect(update({ roots, repo: root, path: link })).rejects.toThrow("Symbolic links");
    execFileSync("git", ["init", "--quiet", web]);
    await expect(update({ roots, repo: root, path })).rejects.toThrow("different Git repository");
    expect(await readFile(path, "utf8")).toBe(source);
  });

  it("refuses to rename the data directory itself", async () => {
    const path = await memory({ title: "Loose" });
    const loose = join(root, NAMES.MEMORIES, NAMES.DATA, NAMES.MEMORY_MD);
    await rename(path, loose);
    await expect(update({ roots, repo: root, path: loose })).rejects.toThrow(
      "into its own directory",
    );
    expect(existsSync(loose)).toBe(true);
  });
});

describe("search", () => {
  it("keeps old memories searchable after adding a required custom field, and validates new writes", async () => {
    const paths = [];
    for (const project of [root, web, team]) {
      paths.push(await memory({ project, title: "Legacy cache" }));
    }
    await config({ project: team, value: { availableToWorkspace: true } });
    const before = await Promise.all(paths.map((path) => readFile(path, "utf8")));
    expect(await search({ roots, repo: root, query: "Legacy" })).toHaveLength(3);
    const custom = { properties: { ticket: { type: "string" } }, required: ["ticket"] };
    await config({ project: root, value: { frontmatter: { custom } } });
    await config({ project: team, value: { availableToWorkspace: true, frontmatter: { custom } } });
    expect(await search({ roots, repo: root, query: "Legacy" })).toHaveLength(3);
    expect(await Promise.all(paths.map((path) => readFile(path, "utf8")))).toEqual(before);
    await expect(memory({ project: web, title: "Missing ticket" })).rejects.toThrow(
      "frontmatter.ticket",
    );
    await expect(edit({ path: paths[1]!, body: "Updated" })).rejects.toThrow("frontmatter.ticket");
    await edit({ path: paths[1]!, ticket: "ENG-1" });
    expect(await frontmatter(paths[1]!)).toMatchObject({ ticket: "ENG-1" });
    expect(await memory({ project: web, title: "New cache", ticket: "ENG-2" })).toBeTypeOf(
      "string",
    );
  });

  it.each([
    {},
    { frontmatter: { custom: { properties: { ticket: { type: "number" } } } } },
    { frontmatter: { custom: { properties: {}, additionalProperties: false } } },
  ])("preserves and searches old custom fields after schema changes: %j", async (value) => {
    await config({
      project: root,
      value: { frontmatter: { custom: { properties: { ticket: { type: "string" } } } } },
    });
    const path = await memory({ title: "Old ticket", ticket: "legacyticket" });
    const before = await readFile(path, "utf8");
    expect(await search({ roots, repo: root, query: "legacyticket" })).toHaveLength(1);
    await config({ project: root, value });
    const result = await search({ roots, repo: root, query: "legacyticket" });
    expect(result).toHaveLength(1);
    expect(result[0]?.frontmatter.ticket).toBe("legacyticket");
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("keeps memories readable when their stored scope no longer exists", async () => {
    const path = await memory({ title: "Cache history", scope: ["apps/web/auth"] });
    await rm(join(web, "auth"), { recursive: true });
    expect((await search({ roots, repo: root, query: "history" }))[0]?.path).toBe(path);
    expect(
      (await search({ roots, repo: root, query: "history", scope: ["apps/web"] }))[0]?.path,
    ).toBe(path);
    await edit({ path, body: "Updated history" });
    expect((await frontmatter(path)).scope).toEqual(["apps/web/auth"]);
  });

  it("still rejects invalid built-in fields without validating custom fields", async () => {
    const path = await memory({ title: "Cache" });
    await writeFile(
      path,
      `---\n${stringify({ ...(await frontmatter(path)), doNotEdit: "true" })}---\nbody\n`,
    );
    await expect(search({ roots, repo: root, query: "Cache" })).rejects.toThrow(
      "frontmatter.doNotEdit",
    );
  });
  it("accepts a workspace folder containing the target repository", async () => {
    await memory({ title: "Cache rule" });
    expect(await search({ roots: [temp], repo: root, query: "cache" })).toHaveLength(1);
  });

  it("deduplicates overlapping shared workspace folders without hiding broader roots", async () => {
    const child = join(team, "child");
    await mkdir(child);
    await writeFile(join(child, NAMES.PACKAGE_JSON), "{}");
    await config({ project: team, value: { availableToWorkspace: true } });
    await memory({ project: team, title: "Cache root" });
    await memory({ project: child, title: "Cache child" });
    expect(await search({ roots: [root, child, team], repo: root, query: "cache" })).toHaveLength(
      2,
    );
  });
  it("searches all project packages globally and ranks titles above bodies", async () => {
    const best = await memory({ project: web, title: "Unicorn" });
    await memory({ project: api, title: "Other", body: "unicorn" });
    const result = await search({ roots, repo: root, query: "unicorn" });
    expect(result).toHaveLength(2);
    expect(result[0]?.path).toBe(best);
    expect(result[0]?.score).toBeGreaterThan(result[1]!.score);
  });

  it("walks up specific scopes without reading malformed sibling memories", async () => {
    const local = await memory({ project: web, title: "Cache local" });
    const global = await memory({ title: "Cache global", scope: ["apps"] });
    await memory({ title: "Cache api-only", scope: ["apps/api"] });
    const sibling = await memory({ project: api, title: "Cache sibling" });
    await writeFile(sibling, "invalid YAML memory");
    await writeFile(join(web, "auth", "session.ts"), "");
    const result = await search({
      roots,
      repo: root,
      query: "cache",
      scope: ["apps/web/auth/session.ts"],
    });
    expect(result.map((entry) => entry.path).sort()).toEqual([local, global].sort());
  });

  it("searches child package stores and relevant ancestors for a directory scope", async () => {
    const parent = await memory({ title: "Cache apps", scope: ["apps"] });
    const child = await memory({ project: web, title: "Cache web" });
    const other = await memory({ project: api, title: "Cache api" });
    const nested = join(web, "plugins", "auth");
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, NAMES.PACKAGE_JSON), "{}");
    const auth = await memory({ project: nested, title: "Cache auth" });
    const outside = join(root, "packages", "billing");
    await mkdir(outside, { recursive: true });
    await memory({ title: "Cache unrelated", scope: ["packages/billing"] });
    await writeFile(join(outside, NAMES.PACKAGE_JSON), "{}");
    const bad = await memory({ project: outside, title: "Cache malformed sibling" });
    await writeFile(bad, "invalid YAML memory");
    const result = await search({ roots, repo: root, query: "cache", scope: ["apps"] });
    expect(result.map((entry) => entry.path).sort()).toEqual([parent, child, other, auth].sort());
    const narrow = await search({ roots, repo: root, query: "cache", scope: ["apps/web"] });
    expect(narrow.map((entry) => entry.path).sort()).toEqual([parent, child, auth].sort());
  });

  it("matches literal file scopes and includes them when searching their directory", async () => {
    await writeFile(join(web, "auth", "session.ts"), "");
    await writeFile(join(web, "auth", "logout.ts"), "");
    await mkdir(join(web, "auth-old"));
    const exact = await memory({ title: "Cache session", scope: ["apps/web/auth/session.ts"] });
    const directory = await memory({ project: web, title: "Cache auth", scope: ["apps/web/auth"] });
    await memory({ title: "Cache other file", scope: ["apps/web/auth/logout.ts"] });
    await memory({ title: "Cache different prefix", scope: ["apps/web/auth-old"] });
    const file = await search({
      roots,
      repo: root,
      query: "cache",
      scope: ["apps/web/auth/session.ts"],
    });
    expect(file.map((entry) => entry.path).sort()).toEqual([exact, directory].sort());
    expect(
      await search({ roots, repo: root, query: "cache", scope: ["apps/web/auth"] }),
    ).toHaveLength(3);
  });

  it("treats Next.js route names literally and includes their child packages", async () => {
    const route = join(web, "app", "(auth)", "[id]");
    const nested = join(route, "forms");
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, NAMES.PACKAGE_JSON), "{}");
    const scoped = await memory({
      project: web,
      title: "Cache route",
      scope: ["apps/web/app/(auth)/[id]"],
    });
    const child = await memory({ project: nested, title: "Cache form" });
    await mkdir(join(web, "app", "(auth)", "i"));
    await memory({
      project: web,
      title: "Cache different route",
      scope: ["apps/web/app/(auth)/i"],
    });
    const result = await search({
      roots,
      repo: root,
      query: "cache",
      scope: ["apps/web/app/(auth)/[id]"],
    });
    expect(result.map((entry) => entry.path).sort()).toEqual([scoped, child].sort());
  });

  it("does not discover sibling packages with a similar directory prefix", async () => {
    const sibling = join(root, "apps", "web-old");
    await mkdir(sibling);
    await writeFile(join(sibling, NAMES.PACKAGE_JSON), "{}");
    const keep = await memory({ project: web, title: "Cache web" });
    const bad = await memory({ project: sibling, title: "Cache sibling" });
    await writeFile(bad, "invalid YAML memory");
    const result = await search({ roots, repo: root, query: "cache", scope: ["apps/web"] });
    expect(result.map((entry) => entry.path)).toEqual([keep]);
  });

  it("skips ignored untracked packages during directory discovery", async () => {
    const ignored = join(web, "generated");
    await mkdir(join(ignored, NAMES.MEMORIES, NAMES.DATA, "bad"), { recursive: true });
    await writeFile(join(ignored, NAMES.PACKAGE_JSON), "{}");
    await writeFile(
      join(ignored, NAMES.MEMORIES, NAMES.DATA, "bad", NAMES.MEMORY_MD),
      "invalid YAML memory",
    );
    await writeFile(join(root, ".gitignore"), "apps/web/generated/\n");
    const keep = await memory({ project: web, title: "Cache web" });
    expect(
      (await search({ roots, repo: root, query: "cache", scope: ["apps"] })).map(
        (entry) => entry.path,
      ),
    ).toEqual([keep]);
  });

  it.each(["apps/*/src/*.ts", "apps/web/auth/**/*", "apps/web/**", "**", "apps/web/?.ts"])(
    "rejects glob %s in both searches and memory scopes",
    async (scope) => {
      await expect(search({ roots, repo: root, query: "cache", scope: [scope] })).rejects.toThrow(
        "Globs are not supported",
      );
      await expect(memory({ title: "Cache rule", scope: [scope] })).rejects.toThrow(
        "Globs are not supported",
      );
      expect(existsSync(join(root, NAMES.MEMORIES))).toBe(false);
    },
  );

  it("reports a legacy glob with its memory path so it can be corrected", async () => {
    const path = await memory({ title: "Cache legacy", scope: ["apps/web/auth"] });
    await writeFile(path, (await readFile(path, "utf8")).replace("apps/web", "apps/*"));
    await expect(search({ roots, repo: root, query: "cache" })).rejects.toThrow(path);
  });

  it("normalizes separators and accepts a whole-repo marker alongside paths", async () => {
    const webPath = await memory({
      project: web,
      title: "Cache web",
      scope: ["apps\\web\\auth\\"],
    });
    await memory({ project: api, title: "Cache api" });
    expect((await frontmatter(webPath)).scope).toEqual(["apps/web/auth"]);
    expect(
      await search({ roots, repo: root, query: "cache", scope: ["./apps//web/auth/"] }),
    ).toHaveLength(1);
    expect(
      await search({ roots, repo: root, query: "cache", scope: ["apps/web", "*"] }),
    ).toHaveLength(2);
    expect(await search({ roots, repo: root, query: "cache", scope: ["."] })).toHaveLength(2);
    await expect(search({ roots, repo: root, query: "cache", scope: [] })).rejects.toThrow(
      "at least one",
    );
  });

  it("unions scopes without duplicating ancestor results", async () => {
    await memory({ title: "Cache common" });
    await memory({ project: api, title: "Cache API" });
    await memory({ project: web, title: "Cache web" });
    const result = await search({
      roots,
      repo: root,
      query: "cache",
      scope: ["apps/web", "apps/api"],
    });
    expect(result).toHaveLength(3);
    expect(new Set(result.map((entry) => entry.path)).size).toBe(3);
  });

  it("shares all stores only when the other repo root opts in, regardless of local scope", async () => {
    const child = join(team, "team-rules");
    await mkdir(child);
    await writeFile(join(child, NAMES.PACKAGE_JSON), "{}");
    await mkdir(join(child, "unrelated"));
    const parent = await memory({ project: team, title: "Cache root" });
    const nested = await memory({
      project: child,
      title: "Cache child",
      scope: ["team-rules/unrelated"],
    });
    const options = { roots, repo: root, query: "cache", scope: ["apps/web"] };
    expect(await search(options)).toEqual([]);
    await config({ project: team, value: { availableToWorkspace: true } });
    expect((await search(options)).map((entry) => entry.path).sort()).toEqual(
      [parent, nested].sort(),
    );
    await config({ project: team, value: { availableToWorkspace: false } });
    expect(await search(options)).toEqual([]);
    expect(await search({ roots, repo: team, query: "cache" })).toHaveLength(2);
  });

  it.each([false, true])("rejects sharing %s declared in another repo's package", async (value) => {
    const child = join(team, "team-rules");
    await mkdir(child);
    await writeFile(join(child, NAMES.PACKAGE_JSON), "{}");
    await config({ project: team, value: { availableToWorkspace: false } });
    await config({ project: child, value: { availableToWorkspace: value } });
    await expect(search({ roots, repo: root, query: "cache" })).rejects.toThrow(
      `Remove availableToWorkspace from ${join(child, NAMES.MEMORIES, NAMES.CONFIG_JSON)}`,
    );
  });

  it("limits and offsets results, with no matches returning an empty array", async () => {
    for (const title of ["Cache alpha", "Cache beta", "Cache gamma"]) await memory({ title });
    const all = await search({ roots, repo: root, query: "cache" });
    expect(await search({ roots, repo: root, query: "cache", limit: 1, offset: 1 })).toEqual(
      all.slice(1, 2),
    );
    expect(await search({ roots, repo: root, query: "nonexistent" })).toEqual([]);
    await expect(search({ roots, repo: root, query: " " })).rejects.toThrow("empty");
    await expect(search({ roots, repo: root, query: "cache", limit: -1 })).rejects.toThrow(
      "positive",
    );
  });

  it("refreshes cached content and config, and drops deleted files", async () => {
    const path = await memory({ title: "Cache", body: "before" });
    expect(await search({ roots, repo: root, query: "before" })).toHaveLength(1);
    expect(await search({ roots, repo: root, query: "before" })).toHaveLength(1);
    const header = await frontmatter(path);
    await writeFile(path, `---\n${stringify(header)}---\n\nafter\n`);
    expect(await search({ roots, repo: root, query: "before" })).toHaveLength(0);
    expect(await search({ roots, repo: root, query: "after" })).toHaveLength(1);
    await config({ project: root, value: { frontmatter: { custom: { required: ["ticket"] } } } });
    expect(await search({ roots, repo: root, query: "after" })).toHaveLength(1);
    await rm(dirname(path), { recursive: true });
    expect(await search({ roots, repo: root, query: "after" })).toEqual([]);
  });

  it("rejects malformed frontmatter and unsupported config versions", async () => {
    const path = await memory({ title: "Valid" });
    await writeFile(path, "---\nid: x\ntitle: [broken\n---\nbody\n");
    await expect(search({ roots, repo: root, query: "body" })).rejects.toThrow("Invalid YAML");
    await config({ project: root, value: { version: 2 } });
    await expect(search({ roots, repo: root, query: "body" })).rejects.toThrow("Invalid config");
  });
});

describe("delete", () => {
  it("rejects a memory.md symlink even when passed its parent folder", async () => {
    const path = await memory({ title: "Keep" });
    const folder = join(root, "alias");
    await mkdir(folder);
    await symlink(path, join(folder, NAMES.MEMORY_MD));
    await expect(deleteMemories({ roots, repo: root, paths: [folder] })).rejects.toThrow(
      "Symbolic links",
    );
    expect(existsSync(path)).toBe(true);
  });

  it("can delete a memory after the custom schema changes", async () => {
    const path = await memory({ title: "Legacy" });
    await config({ project: root, value: { frontmatter: { custom: { required: ["ticket"] } } } });
    await deleteMemories({ roots, repo: root, paths: [path] });
    expect(existsSync(path)).toBe(false);
  });
  it("deletes by file or folder path with attachments and leaves other memories alone", async () => {
    const one = await memory({ title: "One" });
    const two = await memory({ title: "Two" });
    const keep = await memory({ title: "Keep" });
    await writeFile(join(dirname(one), "attachment.txt"), "attachment");
    expect(
      await deleteMemories({ roots, repo: root, paths: [one, dirname(two), one] }),
    ).toHaveLength(2);
    expect(existsSync(dirname(one))).toBe(false);
    expect(existsSync(dirname(two))).toBe(false);
    expect(existsSync(keep)).toBe(true);
  });

  it("preflights every path and refuses a batch containing a protected memory", async () => {
    const one = await memory({ title: "One" });
    const protectedPath = await memory({ title: "Protected", doNotDelete: true });
    await expect(
      deleteMemories({ roots, repo: root, paths: [one, protectedPath] }),
    ).rejects.toThrow("doNotDelete");
    expect(existsSync(one)).toBe(true);
    expect(existsSync(protectedPath)).toBe(true);
  });

  it("does not treat doNotEdit as doNotDelete", async () => {
    const path = await memory({ title: "Editable only by hand", doNotEdit: true });
    await deleteMemories({ roots, repo: root, paths: [path] });
    expect(existsSync(path)).toBe(false);
  });

  it("refuses outside paths, shared search hits, and arbitrary files", async () => {
    const teamPath = await memory({ project: team, title: "Shared" });
    await expect(deleteMemories({ roots, repo: root, paths: [teamPath] })).rejects.toThrow(
      "outside",
    );
    await expect(
      deleteMemories({ roots, repo: root, paths: [join(root, NAMES.PACKAGE_JSON)] }),
    ).rejects.toThrow(NAMES.MEMORY_MD);
    expect(existsSync(teamPath)).toBe(true);
  });

  it("refuses symlink paths and protects nested memories", async () => {
    const parent = await memory({ title: "Parent" });
    const nested = await memory({ title: "Nested", doNotDelete: true });
    await rename(dirname(nested), join(dirname(parent), "nested"));
    await expect(deleteMemories({ roots, repo: root, paths: [parent] })).rejects.toThrow(
      "nested memory",
    );
    const link = join(root, "link");
    await symlink(dirname(parent), link, "dir");
    await expect(
      deleteMemories({ roots, repo: root, paths: [join(link, NAMES.MEMORY_MD)] }),
    ).rejects.toThrow("Symbolic links");
    expect(existsSync(parent)).toBe(true);
  });
});

describe("built CLI", () => {
  it("requires --path even when the legacy JSON contains a path", async () => {
    const path = await memory({ title: "Keep" });
    const before = await readFile(path, "utf8");
    const result = run({
      args: ["update", "--roots", root, "--repo", root],
      input: JSON.stringify({ path, body: "Changed" }),
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toContain("--path");
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it.each(["insert", "update", "search"])(
    "reports a nonexistent scope as a JSON error for %s",
    async (command) => {
      const path = await memory({ project: web, title: "Keep" });
      const before = await readFile(path, "utf8");
      const flags =
        command === "update"
          ? ["--path", path]
          : command === "search"
            ? ["--query", "Keep", "--scope", "bad/bad/bad"]
            : [];
      const result = run({
        args: [command, "--roots", root, "--repo", root, ...flags],
        input: JSON.stringify({
          body: "Changed",
          frontmatter: { title: "Bad", scope: ["bad/bad/bad"] },
        }),
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).error).toContain('Invalid scope: "bad/bad/bad"');
      expect(JSON.parse(result.stderr).error).toContain(
        "Use an existing repository-relative file or directory",
      );
      expect(await readFile(path, "utf8")).toBe(before);
      expect(existsSync(join(root, NAMES.MEMORIES))).toBe(false);
    },
  );
  it("reads an empty patch from a JSON file with a relative --path", async () => {
    const path = await memory({ title: "Repair" });
    const before = await frontmatter(path);
    const wrong = join(dirname(dirname(path)), "wrong-folder");
    await rename(dirname(path), wrong);
    const input = join(root, "update.json");
    await writeFile(input, "{}");
    const result = run({
      args: [
        "update",
        "--roots",
        root,
        "--repo",
        root,
        "--path",
        relative(root, wrong),
        "--input",
        input,
      ],
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual([path]);
    expect(await frontmatter(path)).toEqual(before);
    expect((await search({ roots, repo: root, query: "Repair" }))[0]?.body).toBe(
      "remember this detail\n",
    );
    expect(existsSync(wrong)).toBe(false);
  });

  it.each(["id", "path in JSON", "empty title"])(
    "rejects update input with %s before writing",
    async (invalid) => {
      const path = await memory({ title: "Keep" });
      const before = await readFile(path, "utf8");
      const input =
        invalid === "id"
          ? { frontmatter: { id: (await frontmatter(path)).id } }
          : invalid === "empty title"
            ? { frontmatter: { title: "" } }
            : { path, body: "new content" };
      const result = run({
        args: ["update", "--roots", root, "--repo", root, "--path", path],
        input: JSON.stringify(input),
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).error).toContain("Invalid update input");
      expect(await readFile(path, "utf8")).toBe(before);
    },
  );

  it("requires scope before inserting", () => {
    const result = run({
      args: ["insert", "--roots", root, "--repo", root],
      input: JSON.stringify({ body: "body", frontmatter: { title: "New" } }),
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toContain("scope");
    expect(existsSync(join(root, NAMES.MEMORIES))).toBe(false);
  });

  it("searches a directory's child packages through --scope", async () => {
    const expected = await memory({ project: web, title: "Cache web" });
    const result = run({
      args: ["search", "--roots", root, "--repo", root, "--query", "cache", "--scope", "apps"],
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).map((entry: { path: string }) => entry.path)).toEqual([
      expected,
    ]);
  });

  it.each(["search", "insert"])("returns a JSON error for glob scopes in %s", (command) => {
    const flags = command === "search" ? ["--query", "cache", "--scope", "apps/*"] : [];
    const result = run({
      args: [command, "--roots", root, "--repo", root, ...flags],
      input: JSON.stringify({
        body: "Details",
        frontmatter: { title: "Cache", scope: ["apps/*"] },
      }),
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toContain("Globs are not supported");
  });

  it("prints only JSON for stdin insert, search, and delete", () => {
    const args = ["--roots", root, "--roots", team, "--repo", root];
    const inserted = run({
      args: ["insert", ...args],
      input: JSON.stringify({
        body: "CLI content\n",
        frontmatter: { title: "CLI memory", scope: ["*"] },
      }),
    });
    expect(inserted.status, inserted.stderr).toBe(0);
    expect(inserted.stderr).toBe("");
    const [path] = JSON.parse(inserted.stdout);
    const found = run({ args: ["search", ...args, "--query", "CLI"] });
    expect(found.status, found.stderr).toBe(0);
    expect(found.stderr).toBe("");
    expect(JSON.parse(found.stdout)[0]).toMatchObject({ path, body: "CLI content\n" });
    const deleted = run({ args: ["delete", ...args, "--path", path] });
    expect(deleted.status, deleted.stderr).toBe(0);
    expect(JSON.parse(deleted.stdout)).toEqual([path]);
  });

  it("places by scope and moves the same ID through the CLI", async () => {
    const args = ["--roots", root, "--repo", root];
    const created = run({
      args: ["insert", ...args],
      input: JSON.stringify({
        body: "package body",
        frontmatter: { title: "Package note", scope: ["apps/web"] },
      }),
    });
    expect(created.status, created.stderr).toBe(0);
    const [path] = JSON.parse(created.stdout);
    expect(path).toContain(join(web, NAMES.MEMORIES));
    const id = (await frontmatter(path)).id;
    const updated = run({
      args: ["update", ...args, "--path", path],
      input: JSON.stringify({
        body: "changed body",
        frontmatter: { title: "Updated note", scope: ["apps/api"] },
      }),
    });
    expect(updated.status, updated.stderr).toBe(0);
    const [next] = JSON.parse(updated.stdout);
    expect(next).toContain(join(api, NAMES.MEMORIES));
    expect(await frontmatter(next)).toMatchObject({ id });
    expect(existsSync(path)).toBe(false);
    const deleted = run({ args: ["delete", ...args, "--path", next] });
    expect(deleted.status, deleted.stderr).toBe(0);
    expect(existsSync(next)).toBe(false);
  });

  it.each(["search", "insert", "update", "delete"])(
    "rejects a package as --repo for %s",
    (command) => {
      const flags =
        command === "search"
          ? ["--query", "note"]
          : ["delete", "update"].includes(command)
            ? ["--path", web]
            : [];
      const result = run({
        args: [command, "--roots", root, "--repo", web, ...flags],
        input: JSON.stringify({
          body: "body",
          frontmatter: { title: "Note", scope: ["*"] },
        }),
      });
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stderr).error).toContain("Git root");
    },
  );

  it("reads a JSON file and preserves omitted metadata on update", async () => {
    await config({
      project: root,
      value: { frontmatter: { custom: { properties: { ticket: { type: "string" } } } } },
    });
    const file = join(root, "memory input.json");
    const body =
      '# Cache\n\nUse "quoted" values and `code`.\nPath: C:\\cache\\file\nUnicode: café 🐈\n';
    await writeFile(
      file,
      JSON.stringify({
        body,
        frontmatter: {
          title: "File input",
          scope: ["apps/web"],
          ticket: "ENG-123",
          doNotEdit: false,
          doNotDelete: true,
        },
      }),
    );
    const args = ["--roots", root, "--repo", root];
    const created = run({
      args: ["insert", ...args, "--input", "memory input.json"],
      input: "ignored because --input selects a file",
    });
    expect(created.status, created.stderr).toBe(0);
    expect(created.stderr).toBe("");
    const [path] = JSON.parse(created.stdout);
    expect((await search({ roots, repo: root, query: "Cache" }))[0]?.body).toBe(body);
    const updated = run({
      args: ["update", ...args, "--path", path, "--input", "-"],
      input: JSON.stringify({
        body: "Updated body",
      }),
    });
    expect(updated.status, updated.stderr).toBe(0);
    expect(JSON.parse(updated.stdout)).toEqual([path]);
    expect(await frontmatter(path)).not.toHaveProperty("scope");
    expect(await frontmatter(path)).toMatchObject({
      ticket: "ENG-123",
      doNotEdit: false,
      doNotDelete: true,
    });
    const unprotected = run({
      args: ["update", ...args, "--path", path],
      input: JSON.stringify({
        body: "Updated again",
        frontmatter: {
          doNotDelete: false,
          ticket: "ENG-456",
        },
      }),
    });
    expect(unprotected.status, unprotected.stderr).toBe(0);
    expect(await frontmatter(path)).toMatchObject({ ticket: "ENG-456", doNotDelete: false });
  });

  it("protects JSON memories from later edits", async () => {
    const args = ["--roots", root, "--repo", root];
    const created = run({
      args: ["insert", ...args],
      input: JSON.stringify({
        body: "Original",
        frontmatter: { title: "Protected", doNotEdit: true, scope: ["*"] },
      }),
    });
    expect(created.status, created.stderr).toBe(0);
    const [path] = JSON.parse(created.stdout);
    const before = await readFile(path, "utf8");
    const updated = run({
      args: ["update", ...args, "--path", path],
      input: JSON.stringify({
        body: "Changed",
        frontmatter: { doNotEdit: false },
      }),
    });
    expect(updated.status).toBe(1);
    expect(JSON.parse(updated.stderr).error).toBe(
      `You cannot edit this memory because doNotEdit is true: ${path}. Ask the user to edit it.`,
    );
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it.each([
    { label: "array", value: [] },
    { label: "null", value: null },
    { label: "string", value: "memory" },
    { label: "number", value: 42 },
    { label: "missing body", value: { frontmatter: { title: "Note", scope: ["*"] } } },
    { label: "missing frontmatter", value: { body: "Content" } },
    { label: "missing title", value: { body: "Content", frontmatter: { scope: ["*"] } } },
    {
      label: "blank title",
      value: { body: "Content", frontmatter: { title: "  ", scope: ["*"] } },
    },
    {
      label: "wrong body type",
      value: { body: 42, frontmatter: { title: "Note", scope: ["*"] } },
    },
    {
      label: "blank body",
      value: { body: "\n", frontmatter: { title: "Note", scope: ["*"] } },
    },
    {
      label: "invalid id",
      value: { body: "Content", frontmatter: { title: "Note", scope: ["*"], id: null } },
    },
    {
      label: "removed package",
      value: {
        body: "Content",
        frontmatter: { title: "Note", scope: ["*"] },
        package: "apps/web",
      },
    },
    {
      label: "string scope",
      value: { body: "Content", frontmatter: { title: "Note", scope: "apps/web" } },
    },
    {
      label: "invalid scope item",
      value: { body: "Content", frontmatter: { title: "Note", scope: [1] } },
    },
    {
      label: "empty scopes",
      value: { body: "Content", frontmatter: { title: "Note", scope: [] } },
    },
    {
      label: "non-boolean protection",
      value: { body: "Content", frontmatter: { title: "Note", scope: ["*"], doNotEdit: "true" } },
    },
    {
      label: "null protection",
      value: { body: "Content", frontmatter: { title: "Note", scope: ["*"], doNotDelete: null } },
    },
    {
      label: "old custom envelope",
      value: {
        body: "Content",
        frontmatter: { title: "Note", scope: ["*"] },
        custom: { ticket: "x" },
      },
    },
    {
      label: "unknown field",
      value: { body: "Content", frontmatter: { title: "Note", scope: ["*"] }, typo: true },
    },
    {
      label: "flat payload",
      value: { title: "Note", body: "Content", scope: ["*"] },
    },
    {
      label: "workspace roots",
      value: {
        body: "Content",
        frontmatter: { title: "Note", scope: ["*"] },
        roots: ["/elsewhere"],
      },
    },
    {
      label: "repo",
      value: { body: "Content", frontmatter: { title: "Note", scope: ["*"] }, repo: "/elsewhere" },
    },
  ])("rejects $label before writing a memory", ({ value }) => {
    const result = run({
      args: ["insert", "--roots", root, "--repo", root],
      input: JSON.stringify(value),
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toContain("Invalid insert input");
    expect(existsSync(join(root, NAMES.MEMORIES))).toBe(false);
  });

  it("returns exact fields and expected values for every invalid input field", () => {
    const result = run({
      args: ["insert", "--roots", root, "--repo", root],
      input: JSON.stringify({
        body: 42,
        frontmatter: { title: " ", scope: ["apps/web", 42], doNotEdit: "true" },
        typo: true,
      }),
    });
    expect(result.status).toBe(1);
    const { error } = JSON.parse(result.stderr);
    for (const [field, message] of [
      ["body", "Expected a nonempty string containing the Markdown body"],
      ["frontmatter.title", "Expected a nonempty string for the memory title"],
      ["frontmatter.scope[1]", "Expected a repository-relative file or directory path"],
      ["frontmatter.doNotEdit", "Expected a boolean: true or false"],
      ["typo", "Remove this unknown field. Only body and frontmatter are allowed"],
    ]) {
      expect(error).toContain(`✖ ${message}`);
      expect(error).toContain(`→ at ${field}`);
    }
    expect(result.stdout).toBe("");
    expect(existsSync(join(root, NAMES.MEMORIES))).toBe(false);
  });

  it.each([
    "",
    "plain Markdown",
    '{"title":',
    '{"title":"One","body":"body"}\n{"title":"Two","body":"body"}',
  ])("rejects malformed JSON %j", (input) => {
    const result = run({ args: ["insert", "--roots", root, "--repo", root], input });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toContain("Invalid insert JSON");
    expect(existsSync(join(root, NAMES.MEMORIES))).toBe(false);
  });

  it("returns a JSON error if the input file is missing", () => {
    const result = run({
      args: ["insert", "--roots", root, "--repo", root, "--input", "missing.json"],
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr).error).toContain("ENOENT");
    expect(existsSync(join(root, NAMES.MEMORIES))).toBe(false);
  });

  it("rejects removed payload flags instead of mixing them with JSON", () => {
    const result = run({
      args: ["insert", "--roots", root, "--repo", root, "--title", "Old flag"],
      input: JSON.stringify({
        body: "Content",
        frontmatter: { title: "New JSON", scope: ["*"] },
      }),
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr).error).toContain("unknown option");
  });

  it.each(["insert", "update"])("documents JSON input in %s help", (command) => {
    const result = run({ args: [command, "--help"] });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--input <file>");
    expect(result.stdout).toContain("JSON");
    expect(result.stdout).not.toContain("--body-file");
    expect(result.stdout).not.toContain("--title");
  });

  it.each([
    { args: ["search"] },
    { args: ["search", "--roots", ".", "--repo", ".", "--query", ""] },
    { args: ["prune"] },
    { args: ["delete", "--roots", ".", "--repo", "."] },
  ])("fails with stderr JSON for $args", ({ args }) => {
    const result = run({ args });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toBeTypeOf("string");
  });

  it("lists only this increment's commands and exits successfully for help", () => {
    const result = run({ args: ["--help"] });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: mem-cli");
    expect(result.stdout).toContain("insert");
    expect(result.stdout).toContain("update");
    expect(result.stdout).toContain("mcp");
    expect(result.stdout).not.toContain("upsert");
    expect(result.stdout).not.toContain("prune");
    expect(result.stdout).not.toContain("upvote");
    expect(result.stdout).not.toContain("sessions");
  });
});
