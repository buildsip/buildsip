import * as fs from "node:fs";
import * as path from "node:path";
import type {
  AgentChatParserContext,
  ParsedAgentConversation,
  SessionParseOptions,
  UnifiedSession,
} from "../types/index";
import type { CodexMessage, CodexSessionMeta } from "../types/schemas";
import { findFiles, mapConcurrent } from "../utils/fs-helpers";
import { readJsonlFile, scanJsonlFile, scanJsonlHead } from "../utils/jsonl";
import { extractRepo, homeDir, type MessageDraft, sequenceMessages } from "../utils/parser-helpers";
import { matchesCwd } from "../utils/slug";

const CODEX_HOME_DIR = process.env.CODEX_HOME || path.join(homeDir(), ".codex");
const CODEX_SESSIONS_DIR = path.join(CODEX_HOME_DIR, "sessions");
const CODEX_ARCHIVED_SESSIONS_DIR = path.join(CODEX_HOME_DIR, "archived_sessions");

const MAX_METADATA_SCAN_BYTES = 1024 * 1024;

/**
 * Find all Codex session files recursively
 */
async function findSessionFiles(ctx: AgentChatParserContext): Promise<string[]> {
  return [CODEX_SESSIONS_DIR, CODEX_ARCHIVED_SESSIONS_DIR].flatMap((dir) =>
    findFiles(ctx, dir, {
      match: (entry) => entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl"),
    }),
  );
}

/**
 * Parse session metadata and first user message
 */
async function parseSessionInfo(
  ctx: AgentChatParserContext,
  filePath: string,
): Promise<{
  meta: CodexSessionMeta | null;
  firstUserMessage: string;
}> {
  let meta: CodexSessionMeta | null = null;
  let firstUserMessage = "";

  await scanJsonlHead(
    ctx,
    filePath,
    150,
    (parsed) => {
      const msg = parsed as Record<string, unknown>;

      if (msg.type === "session_meta" && !meta) {
        meta = msg as unknown as CodexSessionMeta;
      }

      if (!firstUserMessage && msg.type === "event_msg") {
        const payload = msg.payload as Record<string, unknown> | undefined;
        if (payload?.type === "user_message") {
          firstUserMessage = (payload.message as string) || "";
        }
      }

      if (
        !firstUserMessage &&
        msg.type === "message" &&
        (msg as Record<string, unknown>).role === "user"
      ) {
        firstUserMessage = typeof msg.content === "string" ? (msg.content as string) : "";
      }

      if (meta && firstUserMessage) {
        return "stop";
      }
      return "continue";
    },
    { maxBytes: MAX_METADATA_SCAN_BYTES },
  );

  return { meta, firstUserMessage };
}

/**
 * Extract session ID and timestamp from filename
 * Format: rollout-YYYY-MM-DDTHH-MM-SS-<uuid>.jsonl
 */
function parseFilename(filename: string): { timestamp: Date; id: string } | null {
  const match = filename.match(
    /rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(.+)\.jsonl$/,
  );
  if (!match) return null;

  const [, year, month, day, hour, min, sec] = match;
  const id = match[7];
  if (id === undefined) return null;
  const timestamp = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`);

  return { timestamp, id };
}

/**
 * Parse all Codex sessions
 */
export async function parseCodexSessions(
  ctx: AgentChatParserContext,
  options: SessionParseOptions = {},
): Promise<UnifiedSession[]> {
  const files = await findSessionFiles(ctx);
  const parsedSessions = await mapConcurrent(
    files,
    16,
    async (filePath): Promise<UnifiedSession | null> => {
      try {
        const filename = path.basename(filePath);
        const parsed = parseFilename(filename);
        if (!parsed) return null;

        const { meta, firstUserMessage } = await parseSessionInfo(ctx, filePath);
        const fileStats = fs.statSync(filePath);

        const payloadRecord = meta?.payload as Record<string, unknown> | undefined;
        const cwd = meta?.payload?.cwd || "";
        if (options.cwd && cwd && !matchesCwd(cwd, options.cwd)) return null;

        const gitUrl = meta?.payload?.git?.repository_url;
        const branch = meta?.payload?.git?.branch;
        const gitSha = meta?.payload?.git?.commit_hash || meta?.payload?.git?.sha;
        const repo = extractRepo({ gitUrl, cwd });
        const lastTranscriptTimestamp =
          fileStats.size <= MAX_METADATA_SCAN_BYTES
            ? await extractLastCodexTimestamp(ctx, filePath)
            : undefined;
        void firstUserMessage;

        return {
          id: parsed.id,
          source: "codex",
          cwd,
          repo,
          branch,
          gitSha,
          createdAt:
            parseValidDate(
              typeof payloadRecord?.timestamp === "string" ? payloadRecord.timestamp : undefined,
            ) ??
            parseValidDate(meta?.timestamp) ??
            parsed.timestamp,
          updatedAt: lastTranscriptTimestamp ?? fileStats.mtime,
          originalPath: filePath,
        };
      } catch (err) {
        ctx.log.debug("codex: skipping unparseable session", filePath, err);
        // Skip files we can't parse
        return null;
      }
    },
  );

  const sessionsById = new Map<string, UnifiedSession>();
  for (const nextSession of parsedSessions) {
    if (!nextSession) continue;
    const existing = sessionsById.get(nextSession.id);
    if (!existing || existing.updatedAt.getTime() < nextSession.updatedAt.getTime()) {
      sessionsById.set(nextSession.id, nextSession);
    }
  }

  const sorted = Array.from(sessionsById.values()).sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  return options.limit ? sorted.slice(0, options.limit) : sorted;
}

/**
 * Read all messages from a Codex session
 */
async function readAllMessages(
  ctx: AgentChatParserContext,
  filePath: string,
): Promise<CodexMessage[]> {
  return readJsonlFile(ctx, filePath);
}

/**
 * Extract visible messages from a Codex session.
 */
export async function extractCodexContext(
  ctx: AgentChatParserContext,
  session: UnifiedSession,
): Promise<ParsedAgentConversation> {
  const messages = await readAllMessages(ctx, session.originalPath);

  // Codex sessions contain both response_item and event_msg for the same conversation turns.
  // Collect from both sources separately to avoid duplicates, then merge preferring response_item.
  const eventMsgEntries: MessageDraft[] = [];
  const responseItemEntries: MessageDraft[] = [];

  for (const msg of messages) {
    if (msg.type === "event_msg") {
      const payload = msg.payload;
      if (payload?.type === "user_message") {
        const content = payload.message || msg.message || "";
        if (content) {
          eventMsgEntries.push({ role: "user", content, timestamp: new Date(msg.timestamp) });
        }
      } else if (payload?.type === "agent_message" || payload?.type === "assistant_message") {
        const content = payload?.message || "";
        if (content) {
          eventMsgEntries.push({ role: "assistant", content, timestamp: new Date(msg.timestamp) });
        }
      }
    } else if (msg.type === "response_item") {
      const payload = msg.payload;
      if (payload?.role === "user" && payload.type === "message") {
        const contentParts = payload.content || [];
        const text = contentParts
          .filter((c) => c.type === "input_text" && c.text)
          .map((c) => c.text)
          .join("\n");
        // Skip system-injected content (AGENTS.md instructions, environment_context, permissions)
        if (
          text &&
          !text.startsWith("<environment_context>") &&
          !text.startsWith("<permissions") &&
          !text.startsWith("# AGENTS.md")
        ) {
          responseItemEntries.push({
            role: "user",
            content: text,
            timestamp: new Date(msg.timestamp),
          });
        }
      } else if (payload?.role === "assistant" && payload.type === "message") {
        const contentParts = payload.content || [];
        const text = contentParts
          .filter((c) => (c.type === "output_text" || c.type === "text") && c.text)
          .map((c) => c.text)
          .join("\n");
        if (text) {
          responseItemEntries.push({
            role: "assistant",
            content: text,
            timestamp: new Date(msg.timestamp),
          });
        }
      }
      // Skip payload.type === 'reasoning' (chain-of-thought, not a message)
      // Skip payload.role === 'developer' (system instructions)
    }
  }

  // Prefer response_item entries (newer, richer format) when available; fall back to event_msg
  const hasResponseItems =
    responseItemEntries.some((m) => m.role === "user") ||
    responseItemEntries.some((m) => m.role === "assistant");
  const allMessages = hasResponseItems ? responseItemEntries : eventMsgEntries;

  return {
    session,
    messages: sequenceMessages(allMessages),
  };
}
function parseValidDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

async function extractLastCodexTimestamp(
  ctx: AgentChatParserContext,
  filePath: string,
): Promise<Date | undefined> {
  let lastTimestamp: Date | undefined;
  await scanJsonlFile(
    ctx,
    filePath,
    (parsed) => {
      const timestamp = parseValidDate((parsed as { timestamp?: string }).timestamp);
      if (timestamp) lastTimestamp = timestamp;
      return "continue";
    },
    { maxBytes: MAX_METADATA_SCAN_BYTES },
  );
  return lastTimestamp;
}
