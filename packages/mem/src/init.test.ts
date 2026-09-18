import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { confirm, log, outro } from "@clack/prompts";
import { parse } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init } from "./commands/init";
import { NAMES } from "./names";

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, execFileSync: vi.fn(original.execFileSync) };
});
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return { ...original, writeFileSync: vi.fn(original.writeFileSync) };
});
vi.mock("@clack/prompts", async (importOriginal) => {
  const original = await importOriginal<typeof import("@clack/prompts")>();
  return {
    ...original,
    confirm: vi.fn(),
    intro: vi.fn(),
    log: { info: vi.fn(), step: vi.fn(), warn: vi.fn() },
    outro: vi.fn(),
  };
});

describe("mem-cli init", () => {
  let temp: string;
  let root: string;
  let web: string;
  let cliRoot: string;
  let globalRoot: string;
  let latest: string;
  let bunMissing: boolean;
  let failure: string | undefined;
  let cancelled: boolean | symbol;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("MEMORIES_DATABASE_URL", "");
    vi.stubEnv("npm_config_user_agent", "pnpm/11.24.0 npm/? node/v22.0.0");
    latest = "0.2.0";
    bunMissing = false;
    failure = undefined;
    const original =
      await vi.importActual<typeof import("node:child_process")>("node:child_process");
    vi.mocked(execFileSync).mockImplementation((...args) => {
      if (["pnpm", "npm", "yarn", "bun"].includes(args[0])) {
        const command = (args[1] as string[])[0];
        if (command === failure) throw new Error(`Could not ${command}`);
        if (command === "root") return globalRoot;
        if (command === "global" && (args[1] as string[])[1] === "dir") return dirname(globalRoot);
        if (command === "pm") {
          if (bunMissing)
            throw Object.assign(new Error("No global packages"), {
              stderr: `error: No package.json was found for directory "${dirname(globalRoot)}"`,
            });
          return `${dirname(globalRoot)} node_modules (1 installed)\n└── mem@0.1.0\n`;
        }
        if (command === "view" || command === "info")
          return JSON.stringify(args[0] === "yarn" ? { type: "inspect", data: latest } : latest);
        return Buffer.from("");
      }
      return Reflect.apply(original.execFileSync, undefined, args);
    });
    const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
    vi.mocked(writeFileSync).mockImplementation(fs.writeFileSync);
    vi.mocked(confirm)
      .mockReset()
      .mockImplementation(async (options) => options.initialValue ?? false);
    const prompts = await vi.importActual<typeof import("@clack/prompts")>("@clack/prompts");
    cancelled = await prompts.confirm({
      message: "Cancel",
      signal: AbortSignal.abort(),
      input: new PassThrough(),
      output: new PassThrough(),
    });
    temp = realpathSync(mkdtempSync(join(tmpdir(), "mem-init-")));
    root = join(temp, "repo with spaces");
    web = join(root, "apps", "web");
    cliRoot = join(temp, "mem source");
    globalRoot = join(temp, "global with spaces", NAMES.NODE_MODULES);
    mkdirSync(join(web, "src"), { recursive: true });
    mkdirSync(join(cliRoot, "scripts"), { recursive: true });
    writeFileSync(join(cliRoot, "scripts", "build.mjs"), "");
    writeFileSync(
      join(cliRoot, NAMES.PACKAGE_JSON),
      JSON.stringify({
        name: "mem",
        version: "0.1.0",
        private: true,
        bin: { "mem-cli": "dist/index.js" },
      }),
    );
    writeFileSync(join(root, NAMES.PACKAGE_JSON), '{"name":"@acme/monorepo"}');
    writeFileSync(join(web, NAMES.PACKAGE_JSON), '{"name":"@acme/web"}');
    execFileSync("git", ["init", "--quiet", root]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    rmSync(temp, { recursive: true, force: true });
  });

  function existing(value: object) {
    mkdirSync(join(root, NAMES.MEMORIES), { recursive: true });
    writeFileSync(join(root, NAMES.MEMORIES, NAMES.CONFIG_JSON), JSON.stringify(value));
  }

  function installed(version: string) {
    mkdirSync(join(globalRoot, "mem"), { recursive: true });
    writeFileSync(
      join(globalRoot, "mem", NAMES.PACKAGE_JSON),
      JSON.stringify({ name: "mem", version, bin: { "mem-cli": "dist/index.js" } }),
    );
  }

  function published() {
    vi.stubEnv("npm_config_user_agent", "npm/11.0.0 node/v22.0.0");
    writeFileSync(
      join(cliRoot, NAMES.PACKAGE_JSON),
      JSON.stringify({ name: "mem", version: "0.1.0", bin: { "mem-cli": "dist/index.js" } }),
    );
  }

  it("creates only config at the monorepo root and installs the built local CLI", async () => {
    await init({ cwd: root, cliRoot });
    const memories = join(root, NAMES.MEMORIES);
    expect(JSON.parse(readFileSync(join(memories, NAMES.CONFIG_JSON), "utf8"))).toEqual({
      version: 1,
      availableToWorkspace: false,
      prune: false,
    });
    expect(readdirSync(memories)).toEqual([NAMES.CONFIG_JSON]);
    expect(existsSync(join(web, NAMES.MEMORIES))).toBe(false);
    expect(execFileSync).toHaveBeenCalledWith(
      "pnpm",
      ["add", "-g", cliRoot],
      expect.objectContaining({ cwd: root }),
    );
    expect(
      vi
        .mocked(execFileSync)
        .mock.calls.some(([, args]) => Array.isArray(args) && ["build", "view"].includes(args[0]!)),
    ).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(outro).toHaveBeenCalledWith("@acme/monorepo initialized.");
    expect(log.info).not.toHaveBeenCalled();
  });

  it.each(["", "src"])("initializes the repo first from a nested package's %j", async (subdir) => {
    await init({ cwd: join(web, subdir), cliRoot });
    expect(JSON.parse(readFileSync(join(root, NAMES.MEMORIES, NAMES.CONFIG_JSON), "utf8"))).toEqual(
      {
        version: 1,
        availableToWorkspace: false,
        prune: false,
      },
    );
    expect(existsSync(join(web, NAMES.MEMORIES))).toBe(false);
    expect(existsSync(join(web, "src", NAMES.MEMORIES))).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(log.info).toHaveBeenCalledWith(
      `First-time setup: initializing the repository at ${root}. Run mem-cli init again from this package to configure it.`,
    );
    expect(execFileSync).toHaveBeenCalledWith(
      "pnpm",
      ["add", "-g", cliRoot],
      expect.objectContaining({ cwd: root }),
    );
    expect(outro).toHaveBeenCalledWith("@acme/monorepo initialized.");
  });

  it.each(["", "src"])(
    "initializes the nearest package from %j after repo setup",
    async (subdir) => {
      existing({});
      await init({ cwd: join(web, subdir), cliRoot });
      expect(
        JSON.parse(readFileSync(join(web, NAMES.MEMORIES, NAMES.CONFIG_JSON), "utf8")),
      ).toEqual({
        version: 1,
        prune: false,
      });
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(
        vi.mocked(confirm).mock.calls.some(([options]) => options.message.includes("workspace")),
      ).toBe(false);
      expect(readFileSync(join(root, NAMES.MEMORIES, NAMES.CONFIG_JSON), "utf8")).toBe("{}");
      expect(existsSync(join(web, "src", NAMES.MEMORIES))).toBe(false);
      expect(log.info).not.toHaveBeenCalled();
      expect(outro).toHaveBeenCalledWith("@acme/web initialized.");
      expect(existsSync(join(root, NAMES.VSCODE, NAMES.SETTINGS_JSON))).toBe(true);
    },
  );

  it("initializes the package on the next run from the same directory", async () => {
    const cwd = join(web, "src");
    await init({ cwd, cliRoot });
    const path = join(root, NAMES.MEMORIES, NAMES.CONFIG_JSON);
    const source = readFileSync(path, "utf8");
    vi.mocked(confirm).mockClear();
    await init({ cwd, cliRoot });
    expect(readFileSync(path, "utf8")).toBe(source);
    expect(JSON.parse(readFileSync(join(web, NAMES.MEMORIES, NAMES.CONFIG_JSON), "utf8"))).toEqual({
      version: 1,
      prune: false,
    });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(outro).toHaveBeenLastCalledWith("@acme/web initialized.");
  });

  it("preserves an existing package config while completing first-time repo setup", async () => {
    mkdirSync(join(web, NAMES.MEMORIES, NAMES.DATA), { recursive: true });
    const path = join(web, NAMES.MEMORIES, NAMES.CONFIG_JSON);
    const source = '{"prune":{"ttl":"120d"}}';
    writeFileSync(path, source);
    writeFileSync(join(web, NAMES.MEMORIES, NAMES.DATA, "keep.txt"), "keep");
    await init({ cwd: web, cliRoot });
    expect(readFileSync(path, "utf8")).toBe(source);
    expect(readFileSync(join(web, NAMES.MEMORIES, NAMES.DATA, "keep.txt"), "utf8")).toBe("keep");
    expect(JSON.parse(readFileSync(join(root, NAMES.MEMORIES, NAMES.CONFIG_JSON), "utf8"))).toEqual(
      {
        version: 1,
        availableToWorkspace: false,
        prune: false,
      },
    );
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it("offers package reconfiguration once the repo is initialized", async () => {
    existing({});
    mkdirSync(join(web, NAMES.MEMORIES));
    const path = join(web, NAMES.MEMORIES, NAMES.CONFIG_JSON);
    const source = '{"prune":false}';
    writeFileSync(path, source);
    await init({ cwd: join(web, "src"), cliRoot });
    expect(confirm).toHaveBeenCalledExactlyOnceWith({
      message: "@acme/web is already initialized. Reconfigure its settings?",
      initialValue: false,
    });
    expect(readFileSync(path, "utf8")).toBe(source);
    expect(readFileSync(join(root, NAMES.MEMORIES, NAMES.CONFIG_JSON), "utf8")).toBe("{}");
    expect(log.step).not.toHaveBeenCalled();
    expect(outro).toHaveBeenCalledWith("@acme/web unchanged.");
  });

  it.each(["", '{"broken":', '{"version":2}'])(
    "rejects an invalid root config %j from a nested package before setup",
    async (source) => {
      existing({});
      const path = join(root, NAMES.MEMORIES, NAMES.CONFIG_JSON);
      writeFileSync(path, source);
      await expect(init({ cwd: web, cliRoot })).rejects.toThrow("config");
      expect(readFileSync(path, "utf8")).toBe(source);
      expect(existsSync(join(web, NAMES.MEMORIES))).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
      expect(log.step).not.toHaveBeenCalled();
    },
  );

  it("uses a worktree's root and its folder name without a manifest", async () => {
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Mem Test",
        "-c",
        "user.email=mem@example.test",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--allow-empty",
        "-m",
        "fixture",
      ],
      { cwd: root, stdio: "pipe" },
    );
    const worktree = join(temp, "worktree");
    execFileSync("git", ["worktree", "add", "--detach", worktree], { cwd: root, stdio: "pipe" });
    const nested = join(worktree, "packages", "web");
    mkdirSync(join(nested, "src"), { recursive: true });
    writeFileSync(join(nested, NAMES.PACKAGE_JSON), '{"name":"web"}');
    await init({ cwd: join(nested, "src"), cliRoot });
    expect(existsSync(join(worktree, NAMES.MEMORIES, NAMES.CONFIG_JSON))).toBe(true);
    expect(existsSync(join(nested, NAMES.MEMORIES))).toBe(false);
    expect(existsSync(join(root, NAMES.MEMORIES))).toBe(false);
    expect(outro).toHaveBeenCalledWith("worktree initialized.");
  });

  it("fails outside Git before prompting or installing", async () => {
    await expect(init({ cwd: temp, cliRoot })).rejects.toThrow("Git working tree");
    expect(confirm).not.toHaveBeenCalled();
    expect(log.step).not.toHaveBeenCalled();
  });

  it("offers reconfiguration and leaves settings untouched when declined", async () => {
    const value = { frontmatter: { custom: {} }, prune: false };
    existing(value);
    await init({ cwd: root, cliRoot });
    expect(JSON.parse(readFileSync(join(root, NAMES.MEMORIES, NAMES.CONFIG_JSON), "utf8"))).toEqual(
      value,
    );
    expect(confirm).toHaveBeenCalledOnce();
    expect(log.step).not.toHaveBeenCalled();
    expect(outro).toHaveBeenCalledWith("@acme/monorepo unchanged.");
  });

  it("preserves custom settings, durations, and memories during reconfiguration", async () => {
    const value = {
      version: 1,
      availableToWorkspace: true,
      frontmatter: { custom: { properties: { ticket: { type: "string" } } } },
      prune: { ttl: "120d", humanUpvoteAdds: "200d", agentUpvoteAdds: "100d" },
    };
    existing(value);
    mkdirSync(join(root, NAMES.MEMORIES, NAMES.DATA));
    writeFileSync(join(root, NAMES.MEMORIES, NAMES.DATA, "keep.txt"), "keep");
    vi.mocked(confirm).mockResolvedValueOnce(true);
    await init({ cwd: root, cliRoot });
    expect(JSON.parse(readFileSync(join(root, NAMES.MEMORIES, NAMES.CONFIG_JSON), "utf8"))).toEqual(
      value,
    );
    expect(readFileSync(join(root, NAMES.MEMORIES, NAMES.DATA, "keep.txt"), "utf8")).toBe("keep");
    expect(vi.mocked(confirm).mock.calls[1]?.[0].initialValue).toBe(true);
    expect(vi.mocked(confirm).mock.calls[2]?.[0].initialValue).toBe(true);
  });

  it("does not copy inherited sharing or custom schemas into a new package config", async () => {
    existing({
      availableToWorkspace: true,
      frontmatter: { custom: { properties: { ticket: { type: "string" } } } },
      prune: { ttl: "120d" },
    });
    vi.mocked(confirm).mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    await init({ cwd: web, cliRoot });
    expect(JSON.parse(readFileSync(join(web, NAMES.MEMORIES, NAMES.CONFIG_JSON), "utf8"))).toEqual({
      version: 1,
      prune: false,
    });
    expect(vi.mocked(confirm).mock.calls[0]?.[0].initialValue).toBe(true);
  });

  it.each([false, true])(
    "rejects package sharing %s before prompting or installing",
    async (value) => {
      existing({});
      mkdirSync(join(web, NAMES.MEMORIES));
      const path = join(web, NAMES.MEMORIES, NAMES.CONFIG_JSON);
      const source = JSON.stringify({ availableToWorkspace: value });
      writeFileSync(path, source);
      await expect(init({ cwd: web, cliRoot })).rejects.toThrow(
        `Remove availableToWorkspace from ${path}`,
      );
      expect(confirm).not.toHaveBeenCalled();
      expect(log.step).not.toHaveBeenCalled();
      expect(readFileSync(path, "utf8")).toBe(source);
    },
  );

  it("initializes a store already populated by insert without disturbing its data", async () => {
    mkdirSync(join(root, NAMES.MEMORIES, NAMES.DATA), { recursive: true });
    writeFileSync(join(root, NAMES.MEMORIES, NAMES.DATA, "keep.txt"), "keep");
    await init({ cwd: web, cliRoot });
    expect(readFileSync(join(root, NAMES.MEMORIES, NAMES.DATA, "keep.txt"), "utf8")).toBe("keep");
    expect(existsSync(join(root, NAMES.MEMORIES, NAMES.CONFIG_JSON))).toBe(true);
    expect(existsSync(join(web, NAMES.MEMORIES))).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it.each(["file", "dangling symlink"])("rejects an existing .memories %s", async (kind) => {
    if (kind === "file") writeFileSync(join(root, NAMES.MEMORIES), "keep");
    else symlinkSync(join(temp, "missing"), join(root, NAMES.MEMORIES), "dir");
    await expect(init({ cwd: root, cliRoot })).rejects.toThrow();
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2])("cancels prompt %i without writing or installing", async (position) => {
    for (let i = 0; i < position; i++) vi.mocked(confirm).mockResolvedValueOnce(false);
    vi.mocked(confirm).mockResolvedValueOnce(cancelled);
    await expect(init({ cwd: root, cliRoot })).rejects.toThrow("cancelled");
    expect(existsSync(join(root, NAMES.MEMORIES))).toBe(false);
    expect(existsSync(join(root, NAMES.VSCODE))).toBe(false);
    expect(log.step).not.toHaveBeenCalled();
  });

  it("cancels reconfiguration without touching the existing config", async () => {
    existing({ prune: false });
    vi.mocked(confirm).mockResolvedValueOnce(cancelled);
    await expect(init({ cwd: root, cliRoot })).rejects.toThrow("cancelled");
    expect(readFileSync(join(root, NAMES.MEMORIES, NAMES.CONFIG_JSON), "utf8")).toBe(
      '{"prune":false}',
    );
  });

  it.each(["", "postgresql://example.test/memories"])(
    "writes the enabled prune object with URL %j",
    async (url) => {
      vi.stubEnv("MEMORIES_DATABASE_URL", url);
      vi.mocked(confirm)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      await init({ cwd: root, cliRoot });
      const value = JSON.parse(readFileSync(join(root, NAMES.MEMORIES, NAMES.CONFIG_JSON), "utf8"));
      expect(value.prune).toEqual({ ttl: "90d", humanUpvoteAdds: "180d", agentUpvoteAdds: "90d" });
      expect(log.warn).toHaveBeenCalledTimes(url ? 0 : 1);
      expect(existsSync(join(root, ".env"))).toBe(false);
    },
  );

  it("preserves JSONC comments, unrelated settings, and other labels", async () => {
    mkdirSync(join(root, NAMES.VSCODE));
    writeFileSync(
      join(root, NAMES.VSCODE, NAMES.SETTINGS_JSON),
      '{\n // Keep this\n "editor.tabSize": 4,\n "workbench.editor.customLabels.patterns": {"**/index.ts":"${dirname}"},\n}',
    );
    await init({ cwd: root, cliRoot });
    const text = readFileSync(join(root, NAMES.VSCODE, NAMES.SETTINGS_JSON), "utf8");
    expect(text).toContain("// Keep this");
    expect(parse(text)).toEqual({
      "editor.tabSize": 4,
      "workbench.editor.customLabels.patterns": {
        "**/index.ts": "${dirname}",
        [`**/${NAMES.MEMORIES}/**/${NAMES.MEMORY_MD}`]: `\${dirname}/${NAMES.MEMORY_MD}`,
      },
    });
  });

  it.each(["", "// Empty settings\n", "{}", '{"editor.tabSize":4}'])(
    "handles settings %j",
    async (text) => {
      mkdirSync(join(root, NAMES.VSCODE));
      writeFileSync(join(root, NAMES.VSCODE, NAMES.SETTINGS_JSON), text);
      await init({ cwd: root, cliRoot });
      expect(
        parse(readFileSync(join(root, NAMES.VSCODE, NAMES.SETTINGS_JSON), "utf8"))[
          "workbench.editor.customLabels.patterns"
        ],
      ).toEqual({
        [`**/${NAMES.MEMORIES}/**/${NAMES.MEMORY_MD}`]: `\${dirname}/${NAMES.MEMORY_MD}`,
      });
    },
  );

  it.each([
    '{"broken":',
    "[]",
    "null",
    '{"workbench.editor.customLabels.patterns":null}',
    '{"workbench.editor.customLabels.patterns":[]}',
  ])("rejects invalid settings %j before installing", async (text) => {
    mkdirSync(join(root, NAMES.VSCODE));
    const path = join(root, NAMES.VSCODE, NAMES.SETTINGS_JSON);
    writeFileSync(path, text);
    await expect(init({ cwd: root, cliRoot })).rejects.toThrow("Cannot update");
    expect(readFileSync(path, "utf8")).toBe(text);
    expect(log.step).not.toHaveBeenCalled();
  });

  it("leaves editor and ignore files untouched when labels are declined", async () => {
    mkdirSync(join(root, NAMES.VSCODE));
    const paths = [
      join(root, ".gitignore"),
      join(root, ".npmignore"),
      join(root, NAMES.VSCODE, NAMES.SETTINGS_JSON),
    ];
    for (const path of paths) writeFileSync(path, "keep");
    vi.mocked(confirm).mockResolvedValue(false);
    await init({ cwd: root, cliRoot });
    for (const path of paths) expect(readFileSync(path, "utf8")).toBe("keep");
  });

  it("does not scaffold if global installation fails", async () => {
    failure = "add";
    await expect(init({ cwd: root, cliRoot })).rejects.toThrow("Could not add");
    expect(existsSync(join(root, NAMES.MEMORIES))).toBe(false);
    expect(outro).not.toHaveBeenCalled();
  });

  it("skips reinstalling an equal or newer private global CLI", async () => {
    installed("0.2.0");
    await init({ cwd: root, cliRoot });
    expect(log.step).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it("prompts before upgrading a published global CLI", async () => {
    published();
    installed("0.1.0");
    await init({ cwd: root, cliRoot });
    expect(vi.mocked(confirm).mock.calls[3]?.[0].message).toContain("0.1.0 to 0.2.0");
    expect(execFileSync).toHaveBeenCalledWith(
      "npm",
      ["install", "--global", "mem@0.2.0"],
      expect.anything(),
    );
  });

  it("declining an upgrade preserves the global CLI and still initializes the project", async () => {
    published();
    installed("0.1.0");
    vi.mocked(confirm)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    await init({ cwd: root, cliRoot });
    expect(log.step).not.toHaveBeenCalled();
    expect(existsSync(join(root, NAMES.MEMORIES, NAMES.CONFIG_JSON))).toBe(true);
  });

  it("installs the running published version if a first-install upgrade is declined", async () => {
    published();
    vi.mocked(confirm)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    await init({ cwd: root, cliRoot });
    expect(execFileSync).toHaveBeenCalledWith(
      "npm",
      ["install", "--global", "mem@0.1.0"],
      expect.anything(),
    );
  });

  it("cancels an upgrade without writing or installing", async () => {
    published();
    installed("0.1.0");
    vi.mocked(confirm)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(cancelled);
    await expect(init({ cwd: root, cliRoot })).rejects.toThrow("cancelled");
    expect(log.step).not.toHaveBeenCalled();
    expect(existsSync(join(root, NAMES.MEMORIES))).toBe(false);
  });

  it("continues with the running version when the registry is unavailable", async () => {
    published();
    failure = "view";
    await init({ cwd: root, cliRoot });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("Could not check"));
    expect(execFileSync).toHaveBeenCalledWith(
      "npm",
      ["install", "--global", "mem@0.1.0"],
      expect.anything(),
    );
  });

  it("never downgrades a newer installed release", async () => {
    published();
    installed("0.3.0");
    await init({ cwd: root, cliRoot });
    expect(log.step).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it("refuses to overwrite a different global package using the same name", async () => {
    mkdirSync(join(globalRoot, "mem"), { recursive: true });
    writeFileSync(join(globalRoot, "mem", NAMES.PACKAGE_JSON), '{"name":"mem","version":"10.0.0"}');
    await expect(init({ cwd: root, cliRoot })).rejects.toThrow("not this CLI");
    expect(log.step).not.toHaveBeenCalled();
  });

  it("forwards global install output in verbose mode", async () => {
    await init({ cwd: root, cliRoot, verbose: true });
    expect(execFileSync).toHaveBeenCalledWith(
      "pnpm",
      ["add", "-g", cliRoot],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });

  it.each([
    { agent: "pnpm/11.24.0 npm/? node/v22.0.0", manager: "pnpm", args: ["add", "-g"] },
    { agent: "npm/11.0.0 node/v22.0.0", manager: "npm", args: ["install", "--global"] },
    { agent: "yarn/1.22.22 npm/? node/v22.0.0", manager: "yarn", args: ["global", "add"] },
    { agent: "bun/1.3.0", manager: "bun", args: ["add", "-g"] },
  ])(
    "uses the $manager launcher for installation and version checks",
    async ({ agent, manager, args }) => {
      existing({});
      published();
      vi.stubEnv("npm_config_user_agent", agent);
      installed("0.1.0");
      await init({ cwd: join(web, "src"), cliRoot });
      expect(execFileSync).toHaveBeenCalledWith(
        manager,
        [...args, "mem@0.2.0"],
        expect.objectContaining({ cwd: web }),
      );
      expect(vi.mocked(confirm).mock.calls[2]?.[0].message).toContain("0.1.0 to 0.2.0");
    },
  );

  it("ignores repository lockfiles and packageManager when launched with npx", async () => {
    existing({});
    vi.stubEnv("npm_config_user_agent", "npm/11.0.0 node/v22.0.0");
    writeFileSync(join(root, "pnpm-lock.yaml"), "");
    writeFileSync(join(web, "yarn.lock"), "");
    writeFileSync(join(web, "bun.lock"), "");
    writeFileSync(join(web, NAMES.PACKAGE_JSON), '{"name":"web","packageManager":"bun@1.3.0"}');
    await init({ cwd: web, cliRoot });
    expect(execFileSync).toHaveBeenCalledWith(
      "npm",
      ["install", "--global", cliRoot],
      expect.objectContaining({ cwd: web }),
    );
  });

  it.each([undefined, "unknown/1.0"])(
    "falls back to npm without a recognized launcher (%s)",
    async (agent) => {
      vi.stubEnv("npm_config_user_agent", agent);
      await init({ cwd: root, cliRoot });
      expect(execFileSync).toHaveBeenCalledWith(
        "npm",
        ["install", "--global", cliRoot],
        expect.anything(),
      );
    },
  );

  it.each([undefined, "pnpm/11.24.0 npm/? node/v22.0.0"])(
    "recognizes bunx --bun even with inherited launcher metadata (%s)",
    async (agent) => {
      vi.stubEnv("npm_config_user_agent", agent);
      vi.stubGlobal("process", { ...process, versions: { ...process.versions, bun: "1.3.0" } });
      await init({ cwd: root, cliRoot });
      expect(execFileSync).toHaveBeenCalledWith("bun", ["add", "-g", cliRoot], expect.anything());
    },
  );

  it("uses npm for global installation when launched by yarn dlx", async () => {
    vi.stubEnv("npm_config_user_agent", "yarn/4.9.0 npm/? node/v22.0.0");
    await init({ cwd: root, cliRoot });
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("does not support global installs"),
    );
    expect(execFileSync).toHaveBeenCalledWith(
      "npm",
      ["install", "--global", cliRoot],
      expect.anything(),
    );
  });

  it("installs with Bun when no global package.json exists yet", async () => {
    bunMissing = true;
    vi.stubEnv("npm_config_user_agent", "bun/1.3.0");
    await init({ cwd: root, cliRoot });
    expect(execFileSync).toHaveBeenCalledWith("bun", ["add", "-g", cliRoot], expect.anything());
  });

  it("does not mistake a failed Bun lookup for a missing installation", async () => {
    failure = "pm";
    vi.stubEnv("npm_config_user_agent", "bun/1.3.0");
    await expect(init({ cwd: root, cliRoot })).rejects.toThrow("Could not pm");
    expect(log.step).not.toHaveBeenCalled();
  });

  it("preserves config changed while the prompts were open", async () => {
    existing({ prune: false });
    vi.mocked(confirm).mockImplementationOnce(async () => {
      writeFileSync(join(root, NAMES.MEMORIES, NAMES.CONFIG_JSON), '{"prune":{"ttl":"500d"}}');
      return true;
    });
    await expect(init({ cwd: root, cliRoot })).rejects.toThrow("Settings changed");
    expect(readFileSync(join(root, NAMES.MEMORIES, NAMES.CONFIG_JSON), "utf8")).toBe(
      '{"prune":{"ttl":"500d"}}',
    );
  });

  it("preserves a store created by another init during the prompts", async () => {
    vi.mocked(confirm).mockImplementationOnce(async () => {
      mkdirSync(join(root, NAMES.MEMORIES));
      writeFileSync(join(root, NAMES.MEMORIES, "keep"), "keep");
      return false;
    });
    await expect(init({ cwd: root, cliRoot })).rejects.toThrow();
    expect(readFileSync(join(root, NAMES.MEMORIES, "keep"), "utf8")).toBe("keep");
  });

  it("does not truncate the existing config on a failed write", async () => {
    existing({ prune: false });
    vi.mocked(confirm)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    vi.mocked(writeFileSync).mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    await expect(init({ cwd: root, cliRoot })).rejects.toThrow("disk full");
    expect(readFileSync(join(root, NAMES.MEMORIES, NAMES.CONFIG_JSON), "utf8")).toBe(
      '{"prune":false}',
    );
    expect(readdirSync(join(root, NAMES.MEMORIES))).toEqual([NAMES.CONFIG_JSON]);
  });
});
