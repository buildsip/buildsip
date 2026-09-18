import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cliEnv } from "./test/cli-env";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
let temp: string;
let repo: string;
let home: string;
let client: Client | undefined;
let stderr: string;

beforeEach(async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), "mem-mcp-")));
  repo = join(temp, "repo with spaces");
  home = join(temp, "home");
  await mkdir(join(repo, "apps", "web", "src"), { recursive: true });
  await mkdir(join(home, ".cursor"), { recursive: true });
  await writeFile(join(repo, "package.json"), "{}");
  await writeFile(join(repo, "apps", "web", "package.json"), "{}");
  execFileSync("git", ["init", "--quiet", repo]);
  stderr = "";
});

afterEach(async () => {
  await client?.close();
  client = undefined;
  await rm(temp, { recursive: true, force: true });
});

/** Starts the built executable, exercising the actual stdio protocol and startup installer. */
async function connect() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "mcp"],
    cwd: repo,
    env: cliEnv({ home }),
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  client = new Client({ name: "mem-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

function text(result: CallToolResult) {
  expect(result.content).toHaveLength(1);
  const content = result.content[0]!;
  if (content.type !== "text") throw new Error("Expected a text result");
  return content.text;
}

async function call({ name, args = {} }: { name: string; args?: Record<string, unknown> }) {
  return (await client!.callTool({
    name,
    arguments: { roots: [repo], repo, ...args },
  })) as CallToolResult;
}

describe("MCP stdio server", () => {
  it("advertises exactly four tools, field descriptions, required fields, and the package version", async () => {
    const client = await connect();
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.bin).toEqual({ "mem-cli": "./dist/index.js" });
    expect(client.getServerVersion()).toEqual({ name: "mem-cli", version: pkg.version });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "insert-memory",
      "update-memory",
      "search-memories",
      "delete-memories",
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema.required).toEqual(expect.arrayContaining(["roots", "repo"]));
      expect(tool.inputSchema.additionalProperties).toBe(false);
      for (const field of Object.values(tool.inputSchema.properties ?? {})) {
        expect(field).toHaveProperty("description", expect.any(String));
      }
    }
    const insert = tools.find((tool) => tool.name === "insert-memory")!;
    expect(insert.inputSchema.required).toEqual(["roots", "repo", "body", "frontmatter"]);
    const fields = insert.inputSchema.properties!.frontmatter as Tool["inputSchema"];
    expect(fields.required).toEqual(["title", "scope"]);
    expect(fields.additionalProperties).toEqual({});
    expect(fields.properties).not.toHaveProperty("id");
    expect(fields.properties!.title).toMatchObject({ type: "string", minLength: 1 });
    expect(fields.properties!.scope).toMatchObject({ type: "array", minItems: 1 });
    for (const field of Object.values(fields.properties ?? {})) {
      expect(field).toHaveProperty("description", expect.any(String));
    }
    const update = tools.find((tool) => tool.name === "update-memory")!;
    expect(update.inputSchema.required).toEqual(["roots", "repo", "path"]);
    const patch = update.inputSchema.properties!.frontmatter as Tool["inputSchema"];
    expect(patch.required ?? []).toEqual([]);
    expect(patch.properties).not.toHaveProperty("id");
    expect(patch.properties!.scope).toMatchObject({ type: "array", minItems: 1 });
    expect(stderr).toBe("");
  });

  it("inserts, searches, moves, and deletes through the same command behavior", async () => {
    await connect();
    const created = await call({
      name: "insert-memory",
      args: {
        body: "Cache responses carefully",
        frontmatter: { title: "Cache responses", scope: ["*"] },
      },
    });
    expect(created.isError).toBeUndefined();
    const [path] = JSON.parse(text(created));
    expect(path).toBe(join(repo, ".memories/data/cache-responses"));
    const file = join(path, "memory.md");
    const before = await readFile(file, "utf8");
    for (const name of ["update-memory", "delete-memories"]) {
      const result = await call({ name, args: { path: name === "update-memory" ? file : [file] } });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("existing memory directory");
      expect(await readFile(file, "utf8")).toBe(before);
    }
    const found = JSON.parse(
      text(await call({ name: "search-memories", args: { query: "cache" } })),
    );
    expect(found[0]).toMatchObject({ path, body: "Cache responses carefully\n" });
    const updated = await call({
      name: "update-memory",
      args: {
        path: relative(repo, path),
        frontmatter: { title: "Package cache", scope: ["apps/web"] },
      },
    });
    const [next] = JSON.parse(text(updated));
    expect(next).toBe(join(repo, "apps/web/.memories/data/package-cache"));
    expect(existsSync(path)).toBe(false);
    const page = JSON.parse(
      text(
        await call({
          name: "search-memories",
          args: { query: "cache", scope: ["apps"], limit: 1 },
        }),
      ),
    );
    expect(page[0].frontmatter.id).toBe(found[0].frontmatter.id);
    expect(page[0].path).toBe(next);
    expect(page[0].body).toBe(found[0].body);
    expect(
      JSON.parse(
        text(await call({ name: "search-memories", args: { query: "cache", offset: 1 } })),
      ),
    ).toEqual([]);
    expect(
      JSON.parse(text(await call({ name: "delete-memories", args: { path: [next] } }))),
    ).toEqual([next]);
    expect(existsSync(next)).toBe(false);
    expect(stderr).toBe("");
  });

  it("returns bare actionable errors and keeps the server available after invalid calls", async () => {
    await connect();
    for (const args of [
      { roots: undefined },
      { roots: ["."] },
      { repo: join(repo, "apps/web") },
      { limit: 0 },
      { query: "" },
    ]) {
      const result = await call({ name: "search-memories", args: { query: "cache", ...args } });
      expect(result.isError).toBe(true);
      expect(text(result)).not.toMatch(/^\{/);
    }
    const invalid = await call({
      name: "insert-memory",
      args: { body: "Note", frontmatter: { title: "Note" } },
    });
    expect(invalid.isError).toBe(true);
    expect(text(invalid)).toContain("frontmatter");
    expect(text(invalid)).toContain("scope");
    expect(text(invalid)).toContain("Expected a nonempty array of repository-relative");
    const unknown = await call({ name: "old-tool-name" });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toContain("old-tool-name not found");
    const missing = await call({
      name: "delete-memories",
      args: { path: [join(repo, "missing")] },
    });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain("Search again");
    expect(
      JSON.parse(text(await call({ name: "search-memories", args: { query: "cache" } }))),
    ).toEqual([]);
  });

  it("keeps protection and whole-batch deletion checks", async () => {
    await connect();
    const paths: string[] = [];
    for (const [title, protectedMemory] of [
      ["Keep", true],
      ["Other", false],
    ] as const) {
      const created = await call({
        name: "insert-memory",
        args: {
          body: "Original",
          frontmatter: {
            title,
            scope: ["*"],
            doNotEdit: protectedMemory,
            doNotDelete: protectedMemory,
          },
        },
      });
      paths.push(JSON.parse(text(created))[0]);
    }
    const edit = await call({ name: "update-memory", args: { path: paths[0], body: "Changed" } });
    expect(edit.isError).toBe(true);
    expect(text(edit)).toContain("doNotEdit");
    const deleted = await call({ name: "delete-memories", args: { path: [...paths].reverse() } });
    expect(deleted.isError).toBe(true);
    expect(text(deleted)).toContain("doNotDelete");
    expect(paths.every((path) => existsSync(path))).toBe(true);
  });

  it("validates custom frontmatter against the destination store", async () => {
    await mkdir(join(repo, ".memories"));
    await writeFile(
      join(repo, ".memories/config.json"),
      JSON.stringify({
        frontmatter: {
          custom: { properties: { ticket: { type: "string" } }, required: ["ticket"] },
        },
      }),
    );
    await connect();
    const args = {
      body: "Details",
      frontmatter: { title: "Ticket", scope: ["*"], ticket: "ENG-1" },
    };
    expect((await call({ name: "insert-memory", args })).isError).toBeUndefined();
    const invalid = await call({
      name: "insert-memory",
      args: { ...args, frontmatter: { ...args.frontmatter, ticket: 42 } },
    });
    expect(invalid.isError).toBe(true);
    expect(text(invalid)).toContain("ticket");
  });

  it("warns without breaking the protocol when no agents are installed", async () => {
    await rm(join(home, ".cursor"), { recursive: true });
    const client = await connect();
    expect((await client.listTools()).tools).toHaveLength(4);
    expect(stderr).toContain("No installed agents were detected");
    expect(stderr).toContain("api-reference/mcp/installation.md");
  });
});

describe("automatic MCP installation", () => {
  it("overwrites the server on help and version, preserving unrelated entries and refreshing approvals", async () => {
    await mkdir(join(home, ".claude"));
    const config = join(home, ".cursor/mcp.json");
    const other = { command: "other-server", args: [] };
    for (const arg of ["--help", "--version"]) {
      await writeFile(
        config,
        JSON.stringify({ mcpServers: { other, "mem-cli": { command: "old-mem", args: ["old"] } } }),
      );
      const result = spawnSync(process.execPath, [cli, arg], {
        cwd: repo,
        env: cliEnv({ home }),
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      const next = JSON.parse(await readFile(config, "utf8"));
      expect(next.mcpServers).toEqual({ other, "mem-cli": { command: "mem-cli", args: ["mcp"] } });
    }
    const settings = JSON.parse(await readFile(join(home, ".claude/settings.json"), "utf8"));
    expect(settings.permissions.allow).toEqual([
      "mcp__mem-cli__insert-memory",
      "mcp__mem-cli__update-memory",
      "mcp__mem-cli__search-memories",
      "mcp__mem-cli__delete-memories",
    ]);
    expect(existsSync(join(repo, ".cursor"))).toBe(false);
  });

  it("continues the command and installs other agents when a config cannot be written", async () => {
    // A directory where a config file belongs fails writes even when tests run as root.
    await mkdir(join(home, ".cursor/mcp.json"));
    await mkdir(join(home, ".claude"));
    const result = spawnSync(
      process.execPath,
      [cli, "search", "--roots", repo, "--repo", repo, "--query", "cache"],
      {
        cwd: repo,
        env: cliEnv({ home }),
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([]);
    expect(JSON.parse(result.stderr).warning).toContain("Could not install mem-cli for cursor");
    const config = JSON.parse(await readFile(join(home, ".claude.json"), "utf8"));
    expect(config.mcpServers["mem-cli"].command).toBe("mem-cli");
  });
});
