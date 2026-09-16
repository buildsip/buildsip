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
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { confirm, log, outro } from "@clack/prompts";
import { parse } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init } from "./init";

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

describe("mem init", () => {
  let temp: string;
  let root: string;
  let web: string;
  let packageRoot: string;
  let globalRoot: string;
  let latest: string;
  let failure: string | undefined;
  let cancelled: boolean | symbol;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("MEMORIES_DATABASE_URL", "");
    latest = "0.2.0";
    failure = undefined;
    const original =
      await vi.importActual<typeof import("node:child_process")>("node:child_process");
    vi.mocked(execFileSync).mockImplementation((...args) => {
      if (["pnpm", "npm"].includes(args[0])) {
        const command = (args[1] as string[])[0];
        if (command === failure) throw new Error(`Could not ${command}`);
        if (command === "root") return globalRoot;
        if (command === "view") return JSON.stringify(latest);
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
    packageRoot = join(temp, "mem source");
    globalRoot = join(temp, "global");
    mkdirSync(join(web, "src"), { recursive: true });
    mkdirSync(join(packageRoot, "scripts"), { recursive: true });
    writeFileSync(join(packageRoot, "scripts", "build.mjs"), "");
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: "mem",
        version: "0.1.0",
        private: true,
        bin: { mem: "dist/index.js" },
      }),
    );
    writeFileSync(join(root, "package.json"), '{"name":"@acme/monorepo"}');
    writeFileSync(join(web, "package.json"), '{"name":"@acme/web"}');
    execFileSync("git", ["init", "--quiet", root]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(temp, { recursive: true, force: true });
  });

  function existing(value: object) {
    mkdirSync(join(root, ".memories"), { recursive: true });
    writeFileSync(join(root, ".memories", "config.json"), JSON.stringify(value));
  }

  function installed(version: string) {
    mkdirSync(join(globalRoot, "mem"), { recursive: true });
    writeFileSync(
      join(globalRoot, "mem", "package.json"),
      JSON.stringify({ name: "mem", version, bin: { mem: "dist/index.js" } }),
    );
  }

  function published() {
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({ name: "mem", version: "0.1.0", bin: { mem: "dist/index.js" } }),
    );
  }

  it("creates only config at the monorepo root and installs the built local CLI", async () => {
    await init({ cwd: root, packageRoot });
    const memories = join(root, ".memories");
    expect(JSON.parse(readFileSync(join(memories, "config.json"), "utf8"))).toEqual({
      version: 1,
      availableToWorkspace: false,
      prune: false,
    });
    expect(readdirSync(memories)).toEqual(["config.json"]);
    expect(existsSync(join(web, ".memories"))).toBe(false);
    expect(execFileSync).toHaveBeenCalledWith(
      "pnpm",
      ["add", "-g", "."],
      expect.objectContaining({ cwd: packageRoot }),
    );
    expect(
      vi
        .mocked(execFileSync)
        .mock.calls.some(([, args]) => Array.isArray(args) && ["build", "view"].includes(args[0]!)),
    ).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(outro).toHaveBeenCalledWith("@acme/monorepo initialized.");
  });

  it.each(["", "src"])("initializes the nearest package from %j", async (subdir) => {
    await init({ cwd: join(web, subdir), packageRoot });
    expect(existsSync(join(web, ".memories", "config.json"))).toBe(true);
    expect(existsSync(join(root, ".memories"))).toBe(false);
    expect(existsSync(join(web, "src", ".memories"))).toBe(false);
    expect(outro).toHaveBeenCalledWith("@acme/web initialized.");
    expect(existsSync(join(root, ".vscode", "settings.json"))).toBe(true);
  });

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
    await init({ cwd: worktree, packageRoot });
    expect(existsSync(join(worktree, ".memories", "config.json"))).toBe(true);
    expect(outro).toHaveBeenCalledWith("worktree initialized.");
  });

  it("fails outside Git before prompting or installing", async () => {
    await expect(init({ cwd: temp, packageRoot })).rejects.toThrow("Git working tree");
    expect(confirm).not.toHaveBeenCalled();
    expect(log.step).not.toHaveBeenCalled();
  });

  it("offers reconfiguration and leaves settings untouched when declined", async () => {
    const value = { frontmatter: { requireScope: true }, prune: false };
    existing(value);
    await init({ cwd: root, packageRoot });
    expect(JSON.parse(readFileSync(join(root, ".memories", "config.json"), "utf8"))).toEqual(value);
    expect(confirm).toHaveBeenCalledOnce();
    expect(log.step).not.toHaveBeenCalled();
    expect(outro).toHaveBeenCalledWith("@acme/monorepo unchanged.");
  });

  it("preserves custom settings, durations, and memories during reconfiguration", async () => {
    const value = {
      version: 1,
      availableToWorkspace: true,
      frontmatter: { requireScope: true, custom: { properties: { ticket: { type: "string" } } } },
      prune: { ttl: "120d", humanUpvoteAdds: "200d", agentUpvoteAdds: "100d" },
      extension: "keep",
    };
    existing(value);
    mkdirSync(join(root, ".memories", "data"));
    writeFileSync(join(root, ".memories", "data", "keep.txt"), "keep");
    vi.mocked(confirm).mockResolvedValueOnce(true);
    await init({ cwd: root, packageRoot });
    expect(JSON.parse(readFileSync(join(root, ".memories", "config.json"), "utf8"))).toEqual(value);
    expect(readFileSync(join(root, ".memories", "data", "keep.txt"), "utf8")).toBe("keep");
    expect(vi.mocked(confirm).mock.calls[1]?.[0].initialValue).toBe(true);
    expect(vi.mocked(confirm).mock.calls[2]?.[0].initialValue).toBe(true);
  });

  it("does not copy inherited custom schemas into a new package config", async () => {
    existing({
      frontmatter: { requireScope: true, custom: { properties: { ticket: { type: "string" } } } },
      prune: { ttl: "120d" },
    });
    vi.mocked(confirm)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    await init({ cwd: web, packageRoot });
    expect(JSON.parse(readFileSync(join(web, ".memories", "config.json"), "utf8"))).toEqual({
      version: 1,
      availableToWorkspace: false,
      prune: false,
    });
    expect(vi.mocked(confirm).mock.calls[1]?.[0].initialValue).toBe(true);
  });

  it("initializes a store already populated by upsert without disturbing its data", async () => {
    mkdirSync(join(root, ".memories", "data"), { recursive: true });
    writeFileSync(join(root, ".memories", "data", "keep.txt"), "keep");
    await init({ cwd: root, packageRoot });
    expect(readFileSync(join(root, ".memories", "data", "keep.txt"), "utf8")).toBe("keep");
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it.each(["file", "dangling symlink"])("rejects an existing .memories %s", async (kind) => {
    if (kind === "file") writeFileSync(join(root, ".memories"), "keep");
    else symlinkSync(join(temp, "missing"), join(root, ".memories"), "dir");
    await expect(init({ cwd: root, packageRoot })).rejects.toThrow();
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2])("cancels prompt %i without writing or installing", async (position) => {
    for (let i = 0; i < position; i++) vi.mocked(confirm).mockResolvedValueOnce(false);
    vi.mocked(confirm).mockResolvedValueOnce(cancelled);
    await expect(init({ cwd: root, packageRoot })).rejects.toThrow("cancelled");
    expect(existsSync(join(root, ".memories"))).toBe(false);
    expect(existsSync(join(root, ".vscode"))).toBe(false);
    expect(log.step).not.toHaveBeenCalled();
  });

  it("cancels reconfiguration without touching the existing config", async () => {
    existing({ prune: false });
    vi.mocked(confirm).mockResolvedValueOnce(cancelled);
    await expect(init({ cwd: root, packageRoot })).rejects.toThrow("cancelled");
    expect(readFileSync(join(root, ".memories", "config.json"), "utf8")).toBe('{"prune":false}');
  });

  it.each(["", "postgresql://example.test/memories"])(
    "writes the enabled prune object with URL %j",
    async (url) => {
      vi.stubEnv("MEMORIES_DATABASE_URL", url);
      vi.mocked(confirm)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      await init({ cwd: root, packageRoot });
      const value = JSON.parse(readFileSync(join(root, ".memories", "config.json"), "utf8"));
      expect(value.prune).toEqual({ ttl: "90d", humanUpvoteAdds: "180d", agentUpvoteAdds: "90d" });
      expect(log.warn).toHaveBeenCalledTimes(url ? 0 : 1);
      expect(existsSync(join(root, ".env"))).toBe(false);
    },
  );

  it.each([false, true])("converts legacy enabled:%s on reconfiguration", async (enabled) => {
    existing({ prune: { enabled, ttl: "120d", humanUpvoteAdds: "180d", agentUpvoteAdds: "90d" } });
    vi.mocked(confirm).mockResolvedValueOnce(true);
    await init({ cwd: root, packageRoot });
    const value = JSON.parse(readFileSync(join(root, ".memories", "config.json"), "utf8"));
    expect(value.prune).toEqual(
      enabled ? { ttl: "120d", humanUpvoteAdds: "180d", agentUpvoteAdds: "90d" } : false,
    );
  });

  it("preserves JSONC comments, unrelated settings, and other labels", async () => {
    mkdirSync(join(root, ".vscode"));
    writeFileSync(
      join(root, ".vscode", "settings.json"),
      '{\n // Keep this\n "editor.tabSize": 4,\n "workbench.editor.customLabels.patterns": {"**/index.ts":"${dirname}"},\n}',
    );
    await init({ cwd: root, packageRoot });
    const text = readFileSync(join(root, ".vscode", "settings.json"), "utf8");
    expect(text).toContain("// Keep this");
    expect(parse(text)).toEqual({
      "editor.tabSize": 4,
      "workbench.editor.customLabels.patterns": {
        "**/index.ts": "${dirname}",
        "**/.memories/**/memory.md": "${dirname}/memory.md",
      },
    });
  });

  it.each(["", "// Empty settings\n", "{}", '{"editor.tabSize":4}'])(
    "handles settings %j",
    async (text) => {
      mkdirSync(join(root, ".vscode"));
      writeFileSync(join(root, ".vscode", "settings.json"), text);
      await init({ cwd: root, packageRoot });
      expect(
        parse(readFileSync(join(root, ".vscode", "settings.json"), "utf8"))[
          "workbench.editor.customLabels.patterns"
        ],
      ).toEqual({ "**/.memories/**/memory.md": "${dirname}/memory.md" });
    },
  );

  it.each([
    '{"broken":',
    "[]",
    "null",
    '{"workbench.editor.customLabels.patterns":null}',
    '{"workbench.editor.customLabels.patterns":[]}',
  ])("rejects invalid settings %j before installing", async (text) => {
    mkdirSync(join(root, ".vscode"));
    const path = join(root, ".vscode", "settings.json");
    writeFileSync(path, text);
    await expect(init({ cwd: root, packageRoot })).rejects.toThrow("Cannot update");
    expect(readFileSync(path, "utf8")).toBe(text);
    expect(log.step).not.toHaveBeenCalled();
  });

  it("leaves editor and ignore files untouched when labels are declined", async () => {
    mkdirSync(join(root, ".vscode"));
    const paths = [
      join(root, ".gitignore"),
      join(root, ".npmignore"),
      join(root, ".vscode", "settings.json"),
    ];
    for (const path of paths) writeFileSync(path, "keep");
    vi.mocked(confirm).mockResolvedValue(false);
    await init({ cwd: root, packageRoot });
    for (const path of paths) expect(readFileSync(path, "utf8")).toBe("keep");
  });

  it("does not scaffold if global installation fails", async () => {
    failure = "add";
    await expect(init({ cwd: root, packageRoot })).rejects.toThrow("Could not add");
    expect(existsSync(join(root, ".memories"))).toBe(false);
    expect(outro).not.toHaveBeenCalled();
  });

  it("skips reinstalling an equal or newer private global CLI", async () => {
    installed("0.2.0");
    await init({ cwd: root, packageRoot });
    expect(log.step).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it("prompts before upgrading a published global CLI", async () => {
    published();
    installed("0.1.0");
    await init({ cwd: root, packageRoot });
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
    await init({ cwd: root, packageRoot });
    expect(log.step).not.toHaveBeenCalled();
    expect(existsSync(join(root, ".memories", "config.json"))).toBe(true);
  });

  it("installs the running published version if a first-install upgrade is declined", async () => {
    published();
    vi.mocked(confirm)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    await init({ cwd: root, packageRoot });
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
    await expect(init({ cwd: root, packageRoot })).rejects.toThrow("cancelled");
    expect(log.step).not.toHaveBeenCalled();
    expect(existsSync(join(root, ".memories"))).toBe(false);
  });

  it("continues with the running version when the registry is unavailable", async () => {
    published();
    failure = "view";
    await init({ cwd: root, packageRoot });
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
    await init({ cwd: root, packageRoot });
    expect(log.step).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it("refuses to overwrite a different global package using the same name", async () => {
    mkdirSync(join(globalRoot, "mem"), { recursive: true });
    writeFileSync(join(globalRoot, "mem", "package.json"), '{"name":"mem","version":"10.0.0"}');
    await expect(init({ cwd: root, packageRoot })).rejects.toThrow("not this CLI");
    expect(log.step).not.toHaveBeenCalled();
  });

  it("forwards global install output in verbose mode", async () => {
    await init({ cwd: root, packageRoot, verbose: true });
    expect(execFileSync).toHaveBeenCalledWith(
      "pnpm",
      ["add", "-g", "."],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });

  it("preserves config changed while the prompts were open", async () => {
    existing({ prune: false });
    vi.mocked(confirm).mockImplementationOnce(async () => {
      writeFileSync(join(root, ".memories", "config.json"), '{"prune":{"ttl":"500d"}}');
      return true;
    });
    await expect(init({ cwd: root, packageRoot })).rejects.toThrow("Settings changed");
    expect(readFileSync(join(root, ".memories", "config.json"), "utf8")).toBe(
      '{"prune":{"ttl":"500d"}}',
    );
  });

  it("preserves a store created by another init during the prompts", async () => {
    vi.mocked(confirm).mockImplementationOnce(async () => {
      mkdirSync(join(root, ".memories"));
      writeFileSync(join(root, ".memories", "keep"), "keep");
      return false;
    });
    await expect(init({ cwd: root, packageRoot })).rejects.toThrow();
    expect(readFileSync(join(root, ".memories", "keep"), "utf8")).toBe("keep");
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
    await expect(init({ cwd: root, packageRoot })).rejects.toThrow("disk full");
    expect(readFileSync(join(root, ".memories", "config.json"), "utf8")).toBe('{"prune":false}');
    expect(readdirSync(join(root, ".memories"))).toEqual(["config.json"]);
  });
});
