import * as fs from "node:fs";
import * as path from "node:path";
import type {
  AgentChatParserContext,
  ParsedAgentConversation,
  SessionParseOptions,
  UnifiedSession,
} from "../types/index";
import type { ClaudeMessage } from "../types/schemas";
import { extractTextFromBlocks, isRealUserMessage } from "../utils/content";
import { findFiles, mapConcurrent } from "../utils/fs-helpers";
import { readJsonlFile, scanJsonlFile } from "../utils/jsonl";
import { extractRepoFromCwd, homeDir, sequenceMessages } from "../utils/parser-helpers";
import { matchesCwd } from "../utils/slug";

const CLAUDE_PROJECTS_DIR = process.env.CLAUDE_CONFIG_DIR
  ? path.join(process.env.CLAUDE_CONFIG_DIR, "projects")
  : path.join(homeDir(), ".claude", "projects");

export function claudeProjectSlugFromCwd(cwd: string): string {
  return cwd.replace(/\\/g, "/").replace(/:/g, "").replace(/[/.]/g, "-");
}

/**
 * Find all Claude session files recursively
 */
async function findSessionFiles(
  ctx: AgentChatParserContext,
  options: SessionParseOptions = {},
): Promise<string[]> {
  const roots = options.cwd
    ? [path.join(CLAUDE_PROJECTS_DIR, claudeProjectSlugFromCwd(options.cwd))]
    : [CLAUDE_PROJECTS_DIR];

  return roots.flatMap((root) =>
    findFiles(ctx, root, {
      match: (entry) =>
        entry.name.endsWith(".jsonl") &&
        !entry.name.includes("debug") &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i.test(entry.name),
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
  sessionId: string;
  cwd: string;
  gitBranch?: string;
  firstUserMessage: string;
  firstTimestamp?: string;
  lastTimestamp?: string;
}> {
  let sessionId = "";
  let cwd = "";
  let gitBranch = "";
  let firstUserMessage = "";
  let firstTimestamp = "";
  let lastTimestamp = "";
  let firstTimeMs = Number.POSITIVE_INFINITY;
  let lastTimeMs = Number.NEGATIVE_INFINITY;

  const visitor = (parsed: unknown): "continue" | "stop" => {
    if (typeof parsed !== "object" || parsed === null) return "continue";
    const msg = parsed as ClaudeMessage;
    if (msg.sessionId && !sessionId) sessionId = msg.sessionId;
    if (msg.cwd && !cwd) cwd = msg.cwd;
    if (msg.gitBranch && !gitBranch) gitBranch = msg.gitBranch;
    const timestamp = getClaudeMessageTimestamp(msg);
    if (timestamp) {
      const timeMs = Date.parse(timestamp);
      if (!Number.isNaN(timeMs)) {
        if (timeMs < firstTimeMs) {
          firstTimeMs = timeMs;
          firstTimestamp = timestamp;
        }
        if (timeMs > lastTimeMs) {
          lastTimeMs = timeMs;
          lastTimestamp = timestamp;
        }
      }
    }

    if (!firstUserMessage && msg.type === "user" && msg.message?.content) {
      const content = stripClaudeLocalCommandMarkup(extractTextFromBlocks(msg.message.content));
      if (isRealUserMessage(content)) {
        firstUserMessage = content;
      }
    }
    return "continue";
  };

  await scanJsonlFile(ctx, filePath, visitor);

  if (!sessionId) {
    sessionId = path.basename(filePath, ".jsonl");
  }

  return { sessionId, cwd, gitBranch, firstUserMessage, firstTimestamp, lastTimestamp };
}

/**
 * Parse all Claude sessions
 */
export async function parseClaudeSessions(
  ctx: AgentChatParserContext,
  options: SessionParseOptions = {},
): Promise<UnifiedSession[]> {
  const files = await findSessionFiles(ctx, options);
  const parsedSessions = await mapConcurrent(
    files,
    16,
    async (filePath): Promise<UnifiedSession | null> => {
      try {
        const info = await parseSessionInfo(ctx, filePath);
        if (options.cwd && info.cwd && !matchesCwd(info.cwd, options.cwd)) return null;

        const fileStats = fs.statSync(filePath);
        if (fileStats.size <= 200) return null;
        void info.firstUserMessage;
        const repo = extractRepoFromCwd(info.cwd);

        return {
          id: info.sessionId,
          source: "claude",
          cwd: info.cwd,
          repo,
          branch: info.gitBranch,
          createdAt: info.firstTimestamp ? new Date(info.firstTimestamp) : fileStats.birthtime,
          updatedAt: info.lastTimestamp ? new Date(info.lastTimestamp) : fileStats.mtime,
          originalPath: filePath,
        };
      } catch (err) {
        ctx.log.debug("claude: skipping unparseable session", filePath, err);
        // Skip files we can't parse
        return null;
      }
    },
  );

  const sessions = parsedSessions.filter((session): session is UnifiedSession => session !== null);
  const sorted = sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return options.limit ? sorted.slice(0, options.limit) : sorted;
}

/**
 * Check if a user message contains actual human-typed text.
 */
function hasHumanTextBlocks(msg: ClaudeMessage): boolean {
  const content = msg.message?.content;
  if (!content) return false;
  if (typeof content === "string") return isRealUserMessage(stripClaudeLocalCommandMarkup(content));
  return content.some(
    (block) =>
      block.type === "text" &&
      block.text &&
      isRealUserMessage(stripClaudeLocalCommandMarkup(block.text)),
  );
}

function isClaudeMetaMessage(msg: ClaudeMessage): boolean {
  const raw = msg as Record<string, unknown>;
  return (
    raw.isMeta === true || msg.type === "permission-mode" || msg.type === "file-history-snapshot"
  );
}

function stripClaudeLocalCommandMarkup(text: string): string {
  return text
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/giu, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/giu, "")
    .replace(/<command-message>[\s\S]*?<\/command-message>/giu, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/giu, "")
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/giu, "")
    .trim();
}

function getClaudeMessageTimestamp(msg: ClaudeMessage): string | undefined {
  if (msg.timestamp) return msg.timestamp;
  const raw = msg as Record<string, unknown>;
  const snapshot = raw.snapshot;
  if (!snapshot || typeof snapshot !== "object") return undefined;
  const timestamp = (snapshot as Record<string, unknown>).timestamp;
  return typeof timestamp === "string" ? timestamp : undefined;
}

/**
 * Extract visible messages from a Claude session.
 */
export async function extractClaudeContext(
  ctx: AgentChatParserContext,
  session: UnifiedSession,
): Promise<ParsedAgentConversation> {
  const messages = await readJsonlFile<ClaudeMessage>(ctx, session.originalPath);

  const conversational = messages.filter((m) => {
    if (m.type !== "user" && m.type !== "assistant") return false;
    if (isClaudeMetaMessage(m)) return false;
    if (m.isCompactSummary) return false;
    if (m.type === "user" && !hasHumanTextBlocks(m)) return false;
    return true;
  });

  const parsedMessages = conversational.flatMap((msg) => {
    const content = stripClaudeLocalCommandMarkup(
      extractTextFromBlocks(msg.message?.content),
    ).trim();
    if (!content) return [];
    const role: "user" | "assistant" = msg.type === "user" ? "user" : "assistant";
    const rawTimestamp = getClaudeMessageTimestamp(msg);
    const timeMs = rawTimestamp ? Date.parse(rawTimestamp) : Number.NaN;
    return [
      {
        role,
        content,
        ...(Number.isFinite(timeMs) ? { timestamp: new Date(timeMs) } : {}),
        sourceId: msg.uuid,
        sourceParentId: msg.parentUuid,
      },
    ];
  });
  return {
    session,
    messages: sequenceMessages(parsedMessages),
  };
}
