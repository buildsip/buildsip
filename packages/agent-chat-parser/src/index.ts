/**
 * Public parser API.
 */

// ── Errors ───────────────────────────────────────────────────────────
export {
  ContinuesError,
  IndexError,
  ParseError,
  SessionNotFoundError,
  StorageError,
  ToolNotAvailableError,
  UnknownSourceError,
} from './errors';

// ── Logger ───────────────────────────────────────────────────────────
export type { LogLevel } from './logger';
export { getLogLevel, logger, setLogLevel } from './logger';

// ── Parsers ──────────────────────────────────────────────────────────
export * from './parsers/index';

// ── Types ────────────────────────────────────────────────────────────
export type { ContentBlock, TextBlock } from './types/content-blocks';
export type {
  Message,
  ParsedAgentConversation,
  SessionSource,
  UnifiedSession,
} from './types/index';
export { TOOL_NAMES } from './types/tool-names';

// ── Discovery / Extraction ───────────────────────────────────────────
export {
  findSession,
  formatSession,
  listSessions,
  parseSession,
  sessionsToJsonl,
} from './utils/index';
