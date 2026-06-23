/**
 * Public parser API.
 */

// ── Errors ───────────────────────────────────────────────────────────
export {
  AgentChatParserError,
  IndexError,
  ParseError,
  SessionNotFoundError,
  StorageError,
  ToolNotAvailableError,
  UnknownSourceError,
} from "./errors";

// ── Parsers ──────────────────────────────────────────────────────────
export * from "./parsers/index";

// ── Types ────────────────────────────────────────────────────────────
export type { ContentBlock, TextBlock } from "./types/content-blocks";
export type {
  AgentChatParserContext,
  Message,
  ParsedAgentConversation,
  SessionSource,
  SessionParseOptions,
  UnifiedSession,
} from "./types/index";
export { TOOL_NAMES } from "./types/tool-names";

// ── Discovery / Extraction ───────────────────────────────────────────
export {
  findSession,
  formatSession,
  listSessions,
  parseSession,
  sessionsToJsonl,
} from "./utils/index";
