/**
 * Unified session and visible-message types.
 */

// Import SessionSource locally (used by UnifiedSession below) and re-export
import type { SessionSource } from './tool-names';

// Re-export shared content block types
export type { ContentBlock, TextBlock } from './content-blocks';
export { isSessionSource, type SessionSource, TOOL_NAMES } from './tool-names';

/** Unified session metadata */
export interface UnifiedSession {
  /** Unique session identifier */
  id: string;
  /** Source agent tool */
  source: SessionSource;
  /** Working directory of the session */
  cwd: string;
  /** Git repository (owner/repo format) */
  repo?: string;
  /** Git branch */
  branch?: string;
  /** Git commit SHA when the source tool records it */
  gitSha?: string;
  /** Session creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
  /** Path to original session file/directory */
  originalPath: string;
  /** Model used in the session */
  model?: string;
}

/** Options for session discovery/indexing. Parsers may ignore unsupported filters. */
export interface SessionParseOptions {
  /** Restrict discovery to one source tool. Used by the top-level listSessions API. */
  source?: SessionSource;
  /** Restrict discovery to sessions matching this working directory when the storage layout supports it. */
  cwd?: string;
  /** Stop after collecting this many sessions when the parser can do so without changing sort semantics. */
  limit?: number;
}

/** Visible user/assistant message in normalized format. */
export interface Message {
  /** Chronological position within the parsed conversation. */
  sequence: number;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: Date;
  /** Source-tool message identifier, when available */
  sourceId?: string;
  /** Source-tool parent message identifier, when available */
  sourceParentId?: string;
}

/** Parsed visible conversation for one session. */
export interface ParsedAgentConversation {
  session: UnifiedSession;
  messages: Message[];
}
