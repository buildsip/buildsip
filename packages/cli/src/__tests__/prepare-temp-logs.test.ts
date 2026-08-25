import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function projectLogsDir(homeDir: string, root: string) {
  const rootHash = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return join(homeDir, "projects", rootHash, "logs");
}

async function writeLog(input: { logsDir: string; fileName: string; content: string }) {
  const { logsDir, fileName, content } = input;
  await mkdir(logsDir, { recursive: true });
  await writeFile(
    join(logsDir, fileName),
    `${JSON.stringify({
      cwd: ["/private/path"],
      role: "user",
      content,
      timestamp: "2026-07-10T10:00:00.000Z",
    })}\n`,
    "utf8",
  );
}

describe("prepareTempLogs", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
  });

  it("reads alias stores after current stores and strips cwd from temp logs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "buildsip-prepare-"));
    const homeDir = join(dir, "home");
    const currentRoot = join(dir, "current");
    const aliasRoot = join(dir, "old-name");
    await mkdir(join(currentRoot, ".git"), { recursive: true });
    process.chdir(currentRoot);
    const resolvedCurrentRoot = process.cwd();

    await mkdir(homeDir, { recursive: true });
    await writeFile(
      join(homeDir, "config.json"),
      `${JSON.stringify({
        projects: [{ root: resolvedCurrentRoot, aliases: [aliasRoot] }],
      })}\n`,
      "utf8",
    );

    await writeLog({
      logsDir: projectLogsDir(homeDir, resolvedCurrentRoot),
      fileName: "codex_same.jsonl",
      content: "current log",
    });
    await writeLog({
      logsDir: projectLogsDir(homeDir, aliasRoot),
      fileName: "codex_same.jsonl",
      content: "alias duplicate",
    });
    await writeLog({
      logsDir: projectLogsDir(homeDir, aliasRoot),
      fileName: "codex_alias.jsonl",
      content: "alias log",
    });

    const listSessions = vi.fn(async () => []);
    vi.doMock("@buildsip/cli-auth", () => ({
      findBuildSipHomeDir: () => homeDir,
    }));
    vi.doMock("@buildsip/agent-chat-parser", () => ({
      listSessions,
      parseSession: vi.fn(),
    }));

    const { prepareTempLogs } = await import("../prepare-temp-logs");
    const result = await prepareTempLogs(
      { log: { debug: vi.fn(), warn: vi.fn() } },
      {
        since: "2026-07-10T00:00:00.000Z",
        until: "2026-07-11T00:00:00.000Z",
      },
    );

    const currentLog = (await readFile(join(result.tempLogsDir, "codex_same.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const aliasLog = (await readFile(join(result.tempLogsDir, "codex_alias.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(result.projectRoot).toBe(resolvedCurrentRoot);
    expect(result.aliases).toEqual([aliasRoot]);
    expect(listSessions).toHaveBeenCalledWith(expect.anything(), { cwd: resolvedCurrentRoot });
    expect(listSessions).toHaveBeenCalledWith(expect.anything(), { cwd: aliasRoot });
    expect(currentLog).toEqual([
      {
        role: "user",
        content: "current log",
        timestamp: "2026-07-10T10:00:00.000Z",
      },
    ]);
    expect(aliasLog).toEqual([
      {
        role: "user",
        content: "alias log",
        timestamp: "2026-07-10T10:00:00.000Z",
      },
    ]);
  });

  it("keeps only the last message in each consecutive assistant run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "buildsip-prepare-"));
    const homeDir = join(dir, "home");
    const currentRoot = join(dir, "current");
    await mkdir(join(currentRoot, ".git"), { recursive: true });
    process.chdir(currentRoot);
    const resolvedCurrentRoot = process.cwd();

    const session = {
      id: "cursor-session",
      source: "cursor" as const,
      cwd: resolvedCurrentRoot,
      createdAt: new Date("2026-07-10T10:00:00.000Z"),
      updatedAt: new Date("2026-07-10T10:05:00.000Z"),
      originalPath: join(dir, "cursor-session.jsonl"),
    };
    const listSessions = vi.fn(async () => [session]);
    const parseSession = vi.fn(async () => ({
      session,
      messages: [
        {
          sequence: 0,
          role: "user" as const,
          content: "First request",
          timestamp: new Date("2026-07-10T10:00:00.000Z"),
        },
        {
          sequence: 1,
          role: "assistant" as const,
          content: "Starting work",
          timestamp: new Date("2026-07-10T10:01:00.000Z"),
        },
        {
          sequence: 2,
          role: "assistant" as const,
          content: "First result",
          timestamp: new Date("2026-07-10T10:02:00.000Z"),
        },
        {
          sequence: 3,
          role: "user" as const,
          content: "Follow-up request",
          timestamp: new Date("2026-07-10T10:03:00.000Z"),
        },
        {
          sequence: 4,
          role: "assistant" as const,
          content: "Checking follow-up",
          timestamp: new Date("2026-07-10T10:04:00.000Z"),
        },
        {
          sequence: 5,
          role: "assistant" as const,
          content: "Follow-up result",
          timestamp: new Date("2026-07-10T10:05:00.000Z"),
        },
      ],
    }));

    vi.doMock("@buildsip/cli-auth", () => ({
      findBuildSipHomeDir: () => homeDir,
    }));
    vi.doMock("@buildsip/agent-chat-parser", () => ({ listSessions, parseSession }));

    const { prepareTempLogs } = await import("../prepare-temp-logs");
    const result = await prepareTempLogs(
      { log: { debug: vi.fn(), warn: vi.fn() } },
      {
        since: "2026-07-10T00:00:00.000Z",
        until: "2026-07-11T00:00:00.000Z",
      },
    );
    const messages = (
      await readFile(join(result.tempLogsDir, "cursor_cursor-session.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(messages).toEqual([
      {
        role: "user",
        content: "First request",
        timestamp: "2026-07-10T10:00:00.000Z",
      },
      {
        role: "assistant",
        content: "First result",
        timestamp: "2026-07-10T10:02:00.000Z",
      },
      {
        role: "user",
        content: "Follow-up request",
        timestamp: "2026-07-10T10:03:00.000Z",
      },
      {
        role: "assistant",
        content: "Follow-up result",
        timestamp: "2026-07-10T10:05:00.000Z",
      },
    ]);
  });
});
