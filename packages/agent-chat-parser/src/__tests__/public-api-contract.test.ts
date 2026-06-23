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
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

describe("public API contract", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.CODEX_HOME;
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists sessions and parses all visible user/assistant messages", async () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chat-parser-contract-"));
    tmpDirs.push(codexHome);
    process.env.CODEX_HOME = codexHome;

    const sessionPath = path.join(
      codexHome,
      "sessions",
      "2026",
      "06",
      "22",
      "rollout-2026-06-22T10-00-00-contract-session.jsonl",
    );
    writeJsonl(sessionPath, [
      {
        type: "session_meta",
        timestamp: "2026-06-22T10:00:00.000Z",
        payload: {
          cwd: "/workspaces/acme/widget",
          git: {
            repository_url: "https://github.com/acme/widget.git",
            branch: "main",
            commit_hash: "abc123",
          },
        },
      },
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:01.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Explain the parser contract." }],
        },
      },
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:02.000Z",
        payload: { type: "reasoning", text: "internal reasoning should not be returned" },
      },
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:03.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "It returns session metadata plus visible messages." },
          ],
        },
      },
    ]);

    const { listSessions, parseSession } = await import("../utils/index");
    const sessions = await listSessions(ctx, { source: "codex" });

    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session).toMatchObject({
      id: "contract-session",
      source: "codex",
      cwd: "/workspaces/acme/widget",
      repo: "acme/widget",
      branch: "main",
      gitSha: "abc123",
      originalPath: sessionPath,
    });
    expect("summary" in session).toBe(false);
    expect("lines" in session).toBe(false);
    expect("bytes" in session).toBe(false);

    const parsed = await parseSession(ctx, session);

    expect(parsed.session).toBe(session);
    expect(parsed.messages).toEqual([
      {
        sequence: 0,
        role: "user",
        content: "Explain the parser contract.",
        timestamp: new Date("2026-06-22T10:00:01.000Z"),
      },
      {
        sequence: 1,
        role: "assistant",
        content: "It returns session metadata plus visible messages.",
        timestamp: new Date("2026-06-22T10:00:03.000Z"),
      },
    ]);
  });
});
