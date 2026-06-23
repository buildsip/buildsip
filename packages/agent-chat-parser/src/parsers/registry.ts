import type {
  AgentChatParserContext,
  ParsedAgentConversation,
  SessionParseOptions,
  SessionSource,
  UnifiedSession,
} from "../types/index";
import { TOOL_NAMES } from "../types/tool-names";
import { extractAmpContext, parseAmpSessions } from "./amp";
import { extractAntigravityContext, parseAntigravitySessions } from "./antigravity";
import { extractClaudeContext, parseClaudeSessions } from "./claude";
import {
  extractClineContext,
  extractKiloCodeContext,
  extractRooCodeContext,
  parseClineSessions,
  parseKiloCodeSessions,
  parseRooCodeSessions,
} from "./cline";
import { extractCodexContext, parseCodexSessions } from "./codex";
import { extractCopilotContext, parseCopilotSessions } from "./copilot";
import { extractCrushContext, parseCrushSessions } from "./crush";
import { extractCursorContext, parseCursorSessions } from "./cursor";
import { extractDroidContext, parseDroidSessions } from "./droid";
import { extractGeminiContext, parseGeminiSessions } from "./gemini";
import { extractKimiContext, parseKimiSessions } from "./kimi";
import { extractKiroContext, parseKiroSessions } from "./kiro";
import { extractOpenCodeContext, parseOpenCodeSessions } from "./opencode";
import { extractQwenCodeContext, parseQwenCodeSessions } from "./qwen-code";

/**
 * Adapter interface — single contract for all supported session sources.
 * To add a new tool, create its parser and add an entry here.
 */
export interface ToolAdapter {
  /** Unique identifier — must match a member of the SessionSource union */
  name: SessionSource;
  /** Human-readable label (e.g. "Claude Code") */
  label: string;
  /** Storage directory path (for help text) */
  storagePath: string;
  /** Environment variable that overrides the default storage path (if any) */
  envVar?: string;
  /**
   * Additional environment variables that influence the parser's storage
   * resolution beyond `envVar`. Example: Antigravity falls back to
   * `GEMINI_CLI_HOME` when `ANTIGRAVITY_HOME` is unset.
   */
  extraEnvVars?: string[];
  /** Discover and index sessions. Parsers may ignore unsupported options. */
  parseSessions: (
    ctx: AgentChatParserContext,
    options?: SessionParseOptions,
  ) => Promise<UnifiedSession[]>;
  /** True when parseSessions({ cwd }) can avoid a full global scan. */
  supportsCwdLookup?: boolean;
  /** Parse the full visible conversation for a discovered session. */
  parseSession: (
    ctx: AgentChatParserContext,
    session: UnifiedSession,
  ) => Promise<ParsedAgentConversation>;
}

/**
 * Central registry — single source of truth for all supported tools.
 * Insertion order determines source ordering.
 */
const _adapters: Partial<Record<SessionSource, ToolAdapter>> = {};

function register(adapter: ToolAdapter): void {
  _adapters[adapter.name] = adapter;
}

// ── Claude Code ──────────────────────────────────────────────────────
register({
  name: "claude",
  label: "Claude Code",
  storagePath: "~/.claude/projects/",
  envVar: "CLAUDE_CONFIG_DIR",
  parseSessions: parseClaudeSessions,
  supportsCwdLookup: true,
  parseSession: extractClaudeContext,
});

// ── Codex CLI ────────────────────────────────────────────────────────
register({
  name: "codex",
  label: "Codex CLI",
  storagePath: "~/.codex/sessions/",
  envVar: "CODEX_HOME",
  parseSessions: parseCodexSessions,
  parseSession: extractCodexContext,
});

// ── GitHub Copilot CLI ───────────────────────────────────────────────
register({
  name: "copilot",
  label: "GitHub Copilot CLI",
  storagePath: "~/.copilot/session-state/",
  envVar: "COPILOT_HOME",
  parseSessions: parseCopilotSessions,
  parseSession: extractCopilotContext,
});

// ── Gemini CLI ───────────────────────────────────────────────────────
register({
  name: "gemini",
  label: "Gemini CLI",
  storagePath: "~/.gemini/tmp/*/chats/",
  envVar: "GEMINI_CLI_HOME",
  parseSessions: parseGeminiSessions,
  parseSession: extractGeminiContext,
});

// ── OpenCode ─────────────────────────────────────────────────────────
register({
  name: "opencode",
  label: "OpenCode",
  storagePath: "~/.local/share/opencode/storage/",
  envVar: "XDG_DATA_HOME",
  parseSessions: parseOpenCodeSessions,
  parseSession: extractOpenCodeContext,
});

// ── Factory Droid ────────────────────────────────────────────────────
register({
  name: "droid",
  label: "Factory Droid",
  storagePath: "~/.factory/projects/ (fallback: ~/.factory/sessions/)",
  parseSessions: parseDroidSessions,
  parseSession: extractDroidContext,
});

// ── Cursor AI (Agent CLI) ────────────────────────────────────────────
register({
  name: "cursor",
  label: "Cursor AI",
  storagePath: "~/.cursor/projects/*/agent-transcripts/",
  parseSessions: parseCursorSessions,
  parseSession: extractCursorContext,
});

// ── Amp CLI ──────────────────────────────────────────────────────────
register({
  name: "amp",
  label: "Amp CLI",
  storagePath: "~/.local/share/amp/threads/",
  envVar: "XDG_DATA_HOME",
  parseSessions: parseAmpSessions,
  parseSession: extractAmpContext,
});

// ── Kiro IDE ─────────────────────────────────────────────────────────
register({
  name: "kiro",
  label: "Kiro IDE",
  storagePath: "~/Library/Application Support/Kiro/workspace-sessions/",
  parseSessions: parseKiroSessions,
  parseSession: extractKiroContext,
});

// ── Crush CLI ────────────────────────────────────────────────────────
register({
  name: "crush",
  label: "Crush CLI",
  storagePath: "~/.crush/crush.db",
  // The Crush parser resolves its database path from any of these env vars
  // (see getCrushDbCandidates in src/parsers/crush.ts).
  extraEnvVars: [
    "CRUSH_DB",
    "CRUSH_DB_PATH",
    "CRUSH_DATA_DIR",
    "CRUSH_GLOBAL_DATA",
    "XDG_DATA_HOME",
  ],
  parseSessions: parseCrushSessions,
  parseSession: extractCrushContext,
});

// ── Cline ────────────────────────────────────────────────────────────
register({
  name: "cline",
  label: "Cline",
  storagePath:
    "~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks/",
  envVar: "CLINE_STORAGE_PATH",
  extraEnvVars: ["BUILDSIP_CLINE_STORAGE_PATH"],
  parseSessions: parseClineSessions,
  parseSession: extractClineContext,
});

// ── Roo Code ─────────────────────────────────────────────────────────
register({
  name: "roo-code",
  label: "Roo Code",
  storagePath:
    "~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks/",
  envVar: "ROO_CODE_STORAGE_PATH",
  extraEnvVars: ["ROO_CLINE_STORAGE_PATH", "BUILDSIP_ROO_CODE_STORAGE_PATH"],
  parseSessions: parseRooCodeSessions,
  parseSession: extractRooCodeContext,
});

// ── Kilo Code ────────────────────────────────────────────────────────
register({
  name: "kilo-code",
  label: "Kilo Code",
  storagePath:
    "~/.local/share/kilo/kilo.db (fallback: VS Code globalStorage/kilocode.kilo-code/tasks/)",
  envVar: "KILO_DB",
  extraEnvVars: [
    "XDG_DATA_HOME",
    "LOCALAPPDATA",
    "APPDATA",
    "KILO_CODE_STORAGE_PATH",
    "BUILDSIP_KILO_CODE_STORAGE_PATH",
  ],
  parseSessions: parseKiloCodeSessions,
  parseSession: extractKiloCodeContext,
});

// ── Antigravity ──────────────────────────────────────────────────────
register({
  name: "antigravity",
  label: "Antigravity",
  storagePath: "~/.gemini/antigravity/",
  envVar: "ANTIGRAVITY_HOME",
  // Antigravity's parser falls back to GEMINI_CLI_HOME when ANTIGRAVITY_HOME is unset.
  extraEnvVars: ["GEMINI_CLI_HOME", "ANTIGRAVITY_STATE_DB"],
  parseSessions: parseAntigravitySessions,
  parseSession: extractAntigravityContext,
});

// ── Kimi CLI ──────────────────────────────────────────────────────────
register({
  name: "kimi",
  label: "Kimi CLI",
  storagePath: "~/.kimi/sessions/",
  envVar: "KIMI_SHARE_DIR",
  parseSessions: parseKimiSessions,
  parseSession: extractKimiContext,
});

// ── Qwen Code ────────────────────────────────────────────────────────
register({
  name: "qwen-code",
  label: "Qwen Code",
  // Upstream Qwen Code (packages/core/src/config/storage.ts: Storage.getRuntimeBaseDir)
  // resolves the runtime base via QWEN_RUNTIME_DIR before falling back to
  // ~/.qwen, then writes chats under <runtime-base>/projects/<sanitized-cwd>/chats/.
  // QWEN_HOME is a project-side override kept for fixtures and sandboxed installs.
  storagePath: "$QWEN_RUNTIME_DIR/projects/*/chats/ (default: ~/.qwen/projects/*/chats/)",
  envVar: "QWEN_RUNTIME_DIR",
  extraEnvVars: ["QWEN_HOME"],
  parseSessions: parseQwenCodeSessions,
  parseSession: extractQwenCodeContext,
});

// ── Completeness assertion ──────────────────────────────────────────
// Runs at module load — if a new tool is added to TOOL_NAMES but not
// registered here, this throws immediately with a clear message.
const missing = TOOL_NAMES.filter((name) => !(name in _adapters));
if (missing.length > 0) {
  throw new Error(`Registry incomplete: missing adapter(s) for ${missing.join(", ")}`);
}

// ── Exports ──────────────────────────────────────────────────────────

/** Type-safe adapter lookup — completeness proven by runtime assertion above */
export const adapters: Readonly<Record<SessionSource, ToolAdapter>> = _adapters as Record<
  SessionSource,
  ToolAdapter
>;

/** Ordered list of all tool names — derived from the canonical TOOL_NAMES array */
export const ALL_TOOLS: readonly SessionSource[] = TOOL_NAMES;
