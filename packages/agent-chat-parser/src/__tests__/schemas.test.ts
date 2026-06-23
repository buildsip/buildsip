/**
 * Tests for Zod schemas in src/types/.
 * Covers content-blocks, tool-names, and all parser raw format schemas.
 */
import { describe, expect, it } from "vitest";
import { ContentBlockSchema, TextBlockSchema } from "../types/content-blocks";
import {
  ClaudeMessageSchema,
  CodexCompactedSchema,
  CodexEventMsgSchema,
  CodexMessageSchema,
  CodexResponseItemSchema,
  CodexSessionMetaSchema,
  CodexTurnContextSchema,
  CopilotEventSchema,
  CopilotWorkspaceSchema,
  CursorTranscriptLineSchema,
  DroidEventSchema,
  DroidMessageEventSchema,
  DroidSessionStartSchema,
  DroidSettingsSchema,
  GeminiMessageSchema,
  GeminiSessionSchema,
  KimiMetadataSchema,
  OpenCodeMessageSchema,
  OpenCodeSessionSchema,
  SerializedSessionSchema,
  SqliteSessionRowSchema,
} from "../types/schemas";
import type { SessionSource } from "../types/tool-names";
import { TOOL_NAMES } from "../types/tool-names";

// ── tool-names.ts ────────────────────────────────────────────────────────────

describe("TOOL_NAMES", () => {
  it("contains exactly 16 tools", () => {
    expect(TOOL_NAMES).toHaveLength(16);
  });

  it("includes all known tools", () => {
    const expected: SessionSource[] = [
      "claude",
      "codex",
      "copilot",
      "gemini",
      "opencode",
      "droid",
      "cursor",
      "amp",
      "kiro",
      "crush",
      "cline",
      "roo-code",
      "kilo-code",
      "antigravity",
      "kimi",
      "qwen-code",
    ];
    expect([...TOOL_NAMES]).toEqual(expected);
  });

  it("is frozen at runtime (immutable)", () => {
    expect(Object.isFrozen(TOOL_NAMES)).toBe(true);
  });
});

// ── content-blocks.ts ────────────────────────────────────────────────────────

describe("ContentBlock schemas", () => {
  describe("TextBlockSchema", () => {
    it("accepts valid text block", () => {
      const result = TextBlockSchema.safeParse({ type: "text", text: "hello" });
      expect(result.success).toBe(true);
    });

    it("rejects missing text field", () => {
      const result = TextBlockSchema.safeParse({ type: "text" });
      expect(result.success).toBe(false);
    });

    it("rejects wrong type discriminator", () => {
      const result = TextBlockSchema.safeParse({ type: "thinking", text: "hello" });
      expect(result.success).toBe(false);
    });
  });

  describe("ContentBlockSchema", () => {
    it("discriminates text blocks", () => {
      const result = ContentBlockSchema.safeParse({ type: "text", text: "hello" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.type).toBe("text");
    });

    it("rejects non-text blocks", () => {
      const result = ContentBlockSchema.safeParse({ type: "image", url: "http://..." });
      expect(result.success).toBe(false);
    });
  });
});

// ── Claude schemas ───────────────────────────────────────────────────────────

describe("ClaudeMessageSchema", () => {
  const validMsg = {
    type: "human",
    uuid: "abc-123",
    timestamp: "2025-01-01T00:00:00Z",
    sessionId: "sess_1",
    cwd: "/home/user/project",
    message: {
      role: "user",
      content: "Hello",
    },
  };

  it("accepts valid Claude message", () => {
    const result = ClaudeMessageSchema.safeParse(validMsg);
    expect(result.success).toBe(true);
  });

  it("accepts message with content block array", () => {
    const msg = {
      ...validMsg,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "response" }],
      },
    };
    const result = ClaudeMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it("accepts optional fields (model, isCompactSummary, gitBranch)", () => {
    const msg = {
      ...validMsg,
      model: "claude-sonnet-4-20250514",
      isCompactSummary: true,
      gitBranch: "main",
    };
    const result = ClaudeMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it("tolerates extra fields via passthrough", () => {
    const msg = { ...validMsg, unknownField: "extra data" };
    const result = ClaudeMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it("rejects missing uuid", () => {
    const { uuid, ...noUuid } = validMsg;
    const result = ClaudeMessageSchema.safeParse(noUuid);
    expect(result.success).toBe(false);
  });
});

// ── Codex schemas ────────────────────────────────────────────────────────────

describe("CodexMessageSchema (discriminated union)", () => {
  it("accepts session_meta", () => {
    const result = CodexSessionMetaSchema.safeParse({
      timestamp: "2025-01-01T00:00:00Z",
      type: "session_meta",
      payload: { id: "sess_1", cwd: "/tmp" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts event_msg", () => {
    const result = CodexEventMsgSchema.safeParse({
      timestamp: "2025-01-01T00:00:00Z",
      type: "event_msg",
      payload: { role: "user", message: "hello" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts response_item", () => {
    const result = CodexResponseItemSchema.safeParse({
      timestamp: "2025-01-01T00:00:00Z",
      type: "response_item",
      payload: { type: "message", role: "assistant", content: [{ type: "text", text: "hello" }] },
    });
    expect(result.success).toBe(true);
  });

  it("accepts turn_context", () => {
    const result = CodexTurnContextSchema.safeParse({
      timestamp: "2025-01-01T00:00:00Z",
      type: "turn_context",
      payload: { model: "o3-mini" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts compacted", () => {
    const result = CodexCompactedSchema.safeParse({
      timestamp: "2025-01-01T00:00:00Z",
      type: "compacted",
      payload: { message: "Compacted session summary" },
    });
    expect(result.success).toBe(true);
  });

  it("discriminates correctly in union", () => {
    const meta = {
      timestamp: "2025-01-01T00:00:00Z",
      type: "session_meta",
      payload: { id: "x" },
    };
    const result = CodexMessageSchema.safeParse(meta);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("session_meta");
  });

  it("discriminates compacted in union", () => {
    const result = CodexMessageSchema.safeParse({
      timestamp: "2025-01-01T00:00:00Z",
      type: "compacted",
      payload: { message: "Compacted session summary" },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("compacted");
  });

  it("rejects unknown type in union", () => {
    const result = CodexMessageSchema.safeParse({
      timestamp: "2025-01-01T00:00:00Z",
      type: "unknown_type",
      payload: {},
    });
    expect(result.success).toBe(false);
  });
});

// ── Copilot schemas ──────────────────────────────────────────────────────────

describe("CopilotWorkspaceSchema", () => {
  it("accepts valid workspace", () => {
    const result = CopilotWorkspaceSchema.safeParse({
      id: "ws_1",
      cwd: "/home/user/proj",
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-02T00:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional fields", () => {
    const result = CopilotWorkspaceSchema.safeParse({
      id: "ws_1",
      cwd: "/tmp",
      git_root: "/tmp",
      repository: "owner/repo",
      branch: "main",
      summary: "test session",
      summary_count: 5,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-02T00:00:00Z",
    });
    expect(result.success).toBe(true);
  });
});

describe("CopilotEventSchema", () => {
  it("accepts valid event", () => {
    const result = CopilotEventSchema.safeParse({
      type: "user.message",
      id: "evt_1",
      timestamp: "2025-01-01T00:00:00Z",
      data: { content: "hello" },
    });
    expect(result.success).toBe(true);
  });
});

// ── Gemini schemas ───────────────────────────────────────────────────────────

describe("GeminiMessageSchema", () => {
  it("accepts message with string content", () => {
    const result = GeminiMessageSchema.safeParse({
      id: "msg_1",
      timestamp: "2025-01-01T00:00:00Z",
      type: "user",
      content: "hello",
    });
    expect(result.success).toBe(true);
  });

  it("accepts message with array content", () => {
    const result = GeminiMessageSchema.safeParse({
      id: "msg_1",
      timestamp: "2025-01-01T00:00:00Z",
      type: "model",
      content: [{ text: "response", type: "text" }],
    });
    expect(result.success).toBe(true);
  });
});

describe("GeminiSessionSchema", () => {
  it("accepts valid session", () => {
    const result = GeminiSessionSchema.safeParse({
      sessionId: "sess_1",
      projectHash: "abc123",
      startTime: "2025-01-01T00:00:00Z",
      lastUpdated: "2025-01-02T00:00:00Z",
      messages: [{ id: "msg_1", timestamp: "2025-01-01T00:00:00Z", type: "user", content: "hi" }],
    });
    expect(result.success).toBe(true);
  });
});

// ── OpenCode schemas ─────────────────────────────────────────────────────────

describe("OpenCodeSessionSchema", () => {
  it("accepts valid session", () => {
    const result = OpenCodeSessionSchema.safeParse({
      id: "sess_1",
      projectID: "proj_1",
      directory: "/home/user/proj",
      time: { created: 1704067200, updated: 1704153600 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional metadata fields", () => {
    const result = OpenCodeSessionSchema.safeParse({
      id: "sess_1",
      projectID: "proj_1",
      directory: "/tmp",
      time: { created: 1704067200, updated: 1704153600 },
      slug: "test-session",
      title: "Test Session",
    });
    expect(result.success).toBe(true);
  });
});

describe("OpenCodeMessageSchema", () => {
  it("accepts valid message", () => {
    const result = OpenCodeMessageSchema.safeParse({
      id: "msg_1",
      sessionID: "sess_1",
      role: "user",
      time: { created: 1704067200 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid role", () => {
    const result = OpenCodeMessageSchema.safeParse({
      id: "msg_1",
      sessionID: "sess_1",
      role: "system",
      time: { created: 1704067200 },
    });
    expect(result.success).toBe(false);
  });
});

describe("SqliteSessionRowSchema", () => {
  it("accepts valid SQLite row", () => {
    const result = SqliteSessionRowSchema.safeParse({
      id: "sess_1",
      project_id: "proj_1",
      slug: "test",
      directory: "/tmp",
      title: "Test",
      version: "1.0",
      time_created: 1704067200,
      time_updated: 1704153600,
    });
    expect(result.success).toBe(true);
  });
});

// ── Droid schemas ────────────────────────────────────────────────────────────

describe("DroidEventSchema (discriminated union)", () => {
  it("accepts session_start", () => {
    const result = DroidSessionStartSchema.safeParse({
      type: "session_start",
      id: "sess_1",
      title: "My Session",
      sessionTitle: "My Session",
      cwd: "/home/user/proj",
    });
    expect(result.success).toBe(true);
  });

  it("accepts message event", () => {
    const result = DroidMessageEventSchema.safeParse({
      type: "message",
      id: "msg_1",
      timestamp: "2025-01-01T00:00:00Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    });
    expect(result.success).toBe(true);
  });

  it("discriminates correctly in union", () => {
    const msg = {
      type: "message",
      id: "msg_1",
      timestamp: "2025-01-01T00:00:00Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "I will help." }],
      },
    };
    const result = DroidEventSchema.safeParse(msg);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("message");
  });

  it("rejects unknown type in union", () => {
    const result = DroidEventSchema.safeParse({
      type: "unknown",
      id: "x",
      timestamp: "2025-01-01T00:00:00Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("DroidSettingsSchema", () => {
  it("accepts visible session settings", () => {
    const result = DroidSettingsSchema.safeParse({
      model: "claude-sonnet-4-20250514",
      interactionMode: "auto",
    });
    expect(result.success).toBe(true);
  });
});

// ── Cursor schemas ───────────────────────────────────────────────────────────

describe("CursorTranscriptLineSchema", () => {
  it("accepts user message", () => {
    const result = CursorTranscriptLineSchema.safeParse({
      role: "user",
      message: {
        content: [{ type: "text", text: "fix the bug" }],
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts assistant message with visible text", () => {
    const result = CursorTranscriptLineSchema.safeParse({
      role: "assistant",
      message: {
        content: [{ type: "text", text: "Let me look at the code." }],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects system role", () => {
    const result = CursorTranscriptLineSchema.safeParse({
      role: "system",
      message: { content: [{ type: "text", text: "prompt" }] },
    });
    expect(result.success).toBe(false);
  });
});

// ── Kimi schemas ─────────────────────────────────────────────────────────────

describe("KimiMetadataSchema", () => {
  it("accepts nullable wire_mtime and numeric archived_at", () => {
    const result = KimiMetadataSchema.safeParse({
      session_id: "kimi-session-1",
      archived_at: 1735086302.21,
      wire_mtime: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts legacy/string archived_at values", () => {
    const result = KimiMetadataSchema.safeParse({
      session_id: "kimi-session-2",
      archived_at: "2026-01-01T12:00:00.000Z",
      wire_mtime: 1735086302.21,
    });
    expect(result.success).toBe(true);
  });
});

// ── Serialized Session (Index) ───────────────────────────────────────────────

describe("SerializedSessionSchema", () => {
  const validSession = {
    id: "sess_1",
    source: "claude",
    cwd: "/home/user/project",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
    originalPath: "/home/user/.claude/projects/proj/session.jsonl",
  };

  it("accepts valid session and transforms dates", () => {
    const result = SerializedSessionSchema.safeParse(validSession);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.createdAt).toBeInstanceOf(Date);
      expect(result.data.updatedAt).toBeInstanceOf(Date);
      expect(result.data.createdAt.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    }
  });

  it("validates source against TOOL_NAMES", () => {
    const result = SerializedSessionSchema.safeParse({
      ...validSession,
      source: "unknown_tool",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid source values", () => {
    for (const source of TOOL_NAMES) {
      const result = SerializedSessionSchema.safeParse({ ...validSession, source });
      expect(result.success).toBe(true);
    }
  });

  it("accepts optional fields", () => {
    const result = SerializedSessionSchema.safeParse({
      ...validSession,
      repo: "owner/repo",
      branch: "main",
      gitSha: "abc123",
      model: "claude-sonnet-4-20250514",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const { id, ...noId } = validSession;
    expect(SerializedSessionSchema.safeParse(noId).success).toBe(false);

    const { cwd, ...noCwd } = validSession;
    expect(SerializedSessionSchema.safeParse(noCwd).success).toBe(false);

    const { originalPath, ...noOriginalPath } = validSession;
    expect(SerializedSessionSchema.safeParse(noOriginalPath).success).toBe(false);
  });
});
