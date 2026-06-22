import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tmpDirs: string[] = [];
const ctx = {
  log: {
    debug() {},
    warn() {},
  },
};

function writeJsonl(filePath: string, rows: unknown[]): void {
  const content = rows.map((row) => JSON.stringify(row)).join("\n");
  fs.writeFileSync(filePath, `${content}\n`, "utf8");
}

function createCopilotSession(opts: {
  copilotHome: string;
  sessionId: string;
  workspace?: {
    cwd?: string;
    repository?: string;
    branch?: string;
    summary?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  events: unknown[];
}): string {
  const sessionDir = path.join(opts.copilotHome, "session-state", opts.sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const workspace = [
    `id: ${opts.sessionId}`,
    `cwd: ${opts.workspace?.cwd ?? "/tmp/copilot-project"}`,
    `repository: ${opts.workspace?.repository ?? "acme/copilot-project"}`,
    `branch: ${opts.workspace?.branch ?? "main"}`,
    `summary: "${opts.workspace?.summary ?? "Copilot parser regression"}"`,
    `created_at: ${opts.workspace?.createdAt ?? "2026-04-15T10:00:00.000Z"}`,
    `updated_at: ${opts.workspace?.updatedAt ?? "2026-04-15T10:05:00.000Z"}`,
  ].join("\n");

  fs.writeFileSync(path.join(sessionDir, "workspace.yaml"), `${workspace}\n`, "utf8");
  writeJsonl(path.join(sessionDir, "events.jsonl"), opts.events);

  return sessionDir;
}

async function loadCopilotParserWithHome(
  homeDir: string,
): Promise<typeof import("../parsers/copilot")> {
  vi.resetModules();
  vi.doMock("os", async () => {
    const actual = await vi.importActual<typeof import("os")>("os");
    return {
      ...actual,
      homedir: () => homeDir,
    };
  });
  return import("../parsers/copilot");
}

afterEach(() => {
  vi.doUnmock("os");
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

describe("copilot parser regressions", () => {
  it("discovers sessions from COPILOT_HOME instead of only ~/.copilot", async () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-home-"));
    const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-config-"));
    tmpDirs.push(fakeHome, copilotHome);

    createCopilotSession({
      copilotHome,
      sessionId: "copilot-home-session",
      events: [
        {
          type: "session.start",
          id: "evt-001",
          timestamp: "2026-04-15T10:00:00.000Z",
          parentId: null,
          data: {
            sessionId: "copilot-home-session",
            selectedModel: "claude-sonnet-4",
          },
        },
        {
          type: "user.message",
          id: "evt-002",
          timestamp: "2026-04-15T10:00:01.000Z",
          parentId: "evt-001",
          data: {
            content: "Honor COPILOT_HOME",
          },
        },
      ],
    });

    vi.stubEnv("COPILOT_HOME", copilotHome);
    const { parseCopilotSessions } = await loadCopilotParserWithHome(fakeHome);
    const sessions = await parseCopilotSessions(ctx);

    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.id).toBe("copilot-home-session");
    expect(session.originalPath).toContain(copilotHome);
  });

  it("uses event timestamps and currentModel before stale workspace metadata", async () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-home-"));
    const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-config-"));
    tmpDirs.push(fakeHome, copilotHome);

    createCopilotSession({
      copilotHome,
      sessionId: "event-time-session",
      workspace: {
        updatedAt: "2026-04-15T09:00:00.000Z",
      },
      events: [
        {
          type: "session.start",
          id: "evt-001",
          timestamp: "2026-04-15T10:00:00.000Z",
          parentId: null,
          data: { sessionId: "event-time-session" },
        },
        {
          type: "session.shutdown",
          id: "evt-002",
          timestamp: "2026-04-15T10:12:34.000Z",
          parentId: "evt-001",
          data: { currentModel: "claude-4-current" },
        },
      ],
    });

    vi.stubEnv("COPILOT_HOME", copilotHome);
    const { parseCopilotSessions } = await loadCopilotParserWithHome(fakeHome);
    const sessions = await parseCopilotSessions(ctx);

    const session = sessions[0]!;
    expect(session.updatedAt.toISOString()).toBe("2026-04-15T10:12:34.000Z");
    expect(session.model).toBe("claude-4-current");
  });
});
