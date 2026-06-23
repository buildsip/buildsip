import * as fs from "node:fs";
import * as path from "node:path";
import type {
  AgentChatParserContext,
  ParsedAgentConversation,
  UnifiedSession,
} from "../types/index";
import type { QwenChatRecord, QwenContent, QwenPart } from "../types/schemas";
import { QwenChatRecordSchema } from "../types/schemas";
import { listSubdirectories } from "../utils/fs-helpers";
import { scanJsonlLines } from "../utils/jsonl";
import {
  extractRepoFromCwd,
  homeDir,
  type MessageDraft,
  sequenceMessages,
} from "../utils/parser-helpers";

// Qwen Code stores chats under <runtime-base>/projects/<sanitized-cwd>/chats/<sessionId>.jsonl.
//
// Runtime base resolution mirrors upstream Qwen Code
// (packages/core/src/config/storage.ts: Storage.getRuntimeBaseDir):
//   1. QWEN_RUNTIME_DIR env var (canonical Qwen override)
//   2. ~/.qwen (Storage.getGlobalQwenDir fallback)
// QWEN_HOME is a project-side override (no upstream equivalent) for
// fixtures and sandboxed installs that want to redirect lookups at a custom
// home dir without touching real user data. We treat its value as a home dir
// (joining `.qwen` when not already terminated by it).
//
// cwd sanitization mirrors upstream sanitizeCwd
// (packages/core/src/utils/paths.ts:243): replace /[^a-zA-Z0-9]/g with `-`,
// lowercased on Windows. Tests rely on the same scheme so fixture writes and
// parser reads stay in lockstep.

const MAX_QWEN_JSONL_RECORD_CHARS = 16 * 1024 * 1024;

interface QwenSessionMeta {
  sessionId: string;
  cwd: string;
  gitBranch?: string;
  hasVisibleUserMessage: boolean;
  firstTimestamp?: string;
  lastTimestamp?: string;
  model?: string;
  mtime: Date;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function resolveConfiguredDir(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value === "~") return homeDir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(homeDir(), value.slice(2));
  }
  return path.isAbsolute(value) ? value : path.resolve(value);
}

function getQwenRuntimeBaseDir(): string {
  const runtimeDir = resolveConfiguredDir(process.env.QWEN_RUNTIME_DIR);
  if (runtimeDir) return runtimeDir;

  const qwenHome = resolveConfiguredDir(process.env.QWEN_HOME);
  if (qwenHome) {
    return path.basename(qwenHome) === ".qwen" ? qwenHome : path.join(qwenHome, ".qwen");
  }

  return path.join(homeDir(), ".qwen");
}

function getQwenProjectsDir(): string {
  return path.join(getQwenRuntimeBaseDir(), "projects");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getBooleanField(value: unknown, field: string): boolean | undefined {
  if (!isRecord(value)) return undefined;
  const fieldValue = value[field];
  return typeof fieldValue === "boolean" ? fieldValue : undefined;
}

/** Parse a timestamp string defensively, falling back to a given Date */
function parseTimestamp(ts: string | undefined, fallback: Date): Date {
  if (!ts) return fallback;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function parseQwenChatRecord(
  ctx: AgentChatParserContext,
  parsed: unknown,
  filePath: string,
  lineIndex: number,
): QwenChatRecord | undefined {
  const result = QwenChatRecordSchema.safeParse(parsed);
  if (result.success) return result.data;
  ctx.log.debug("qwen-code: skipping invalid record at index", lineIndex, "in", filePath);
  return undefined;
}

// ── JSONL reading ───────────────────────────────────────────────────────────

/**
 * Recover top-level JSON objects from a single physical JSONL line, even when
 * Qwen Code has glued multiple records together (rare runtime races) or
 * truncated one mid-write.
 *
 * **Scope: top-level objects only.** Upstream Qwen Code writes one
 * `ChatRecord` object per line via `chatRecordingService.ts` (which calls
 * `jsonl.writeLine`/`writeLineSync` with a single `ChatRecord`). It never
 * writes top-level arrays, scalars, or non-object records. Anything that is
 * not a `{ ... }` object — bare arrays, strings, numbers, garbage between
 * records — is intentionally skipped by this splitter so a corrupt fragment
 * cannot spoof a record. If upstream ever changes the on-disk shape, this
 * function has to be updated explicitly; the existing test
 * `'silently skips top-level arrays and scalars while keeping intervening objects'`
 * pins the contract.
 *
 * Recovery semantics: scan forward looking for `{`, track string/escape
 * state, balance `{`/`}`. If the running object never closes (truncated
 * write, unterminated string), skip past the failed `{` and keep scanning
 * for later valid objects on the same line — preventing a single garbled
 * fragment from poisoning trailing valid records glued onto the same line.
 */
function splitJsonObjects(text: string): string[] {
  const objects: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let start: number | undefined;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let closedAt: number | undefined;

    for (let index = cursor; index < text.length; index++) {
      const char = text[index];

      if (start === undefined) {
        // Skip whitespace and any garbage (incl. top-level arrays/scalars)
        // before the next opening brace. See block comment above.
        if (char !== "{") continue;
        start = index;
      }

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "{") {
        depth++;
        continue;
      }

      if (char === "}") {
        depth--;
        if (depth === 0) {
          closedAt = index;
          objects.push(text.slice(start, index + 1));
          break;
        }
      }
    }

    if (closedAt !== undefined) {
      cursor = closedAt + 1;
      continue;
    }

    // The trailing object never closed (unterminated string or missing brace).
    // Skip past the failed opening brace and try to recover later top-level
    // objects on the same line. If no opening brace was found at all, stop.
    if (start === undefined) break;
    cursor = start + 1;
  }

  return objects;
}

async function scanQwenJsonlFile(
  ctx: AgentChatParserContext,
  filePath: string,
  visitor: (parsed: unknown, lineIndex: number) => "continue" | "stop",
): Promise<void> {
  if (!fs.existsSync(filePath)) return;

  await scanJsonlLines(
    ctx,
    filePath,
    (line, lineIndex) => {
      const chunks = splitJsonObjects(line);
      if (chunks.length === 0 && line.trim()) {
        ctx.log.debug(
          "qwen-code: skipping malformed JSONL line at index",
          lineIndex,
          "in",
          filePath,
        );
      }
      for (const chunk of chunks) {
        try {
          if (visitor(JSON.parse(chunk), lineIndex) === "stop") return "stop";
        } catch (err) {
          ctx.log.debug(
            "qwen-code: skipping invalid JSON object at index",
            lineIndex,
            "in",
            filePath,
            err,
          );
        }
      }
      return "continue";
    },
    { maxLineChars: MAX_QWEN_JSONL_RECORD_CHARS },
  );
}

async function readJsonlRecords(
  ctx: AgentChatParserContext,
  filePath: string,
): Promise<QwenChatRecord[]> {
  const records: QwenChatRecord[] = [];
  await scanQwenJsonlFile(ctx, filePath, (parsed, lineIndex) => {
    const record = parseQwenChatRecord(ctx, parsed, filePath, lineIndex);
    if (record) records.push(record);
    return "continue";
  });
  return records;
}

// ── Text extraction ─────────────────────────────────────────────────────────

/** Extract non-thought text from parts */
function extractTextFromParts(parts: QwenPart[] | undefined): string {
  if (!parts) return "";
  return parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text!)
    .join("\n");
}

function extractContentText(content: QwenContent | undefined): string {
  if (!content?.parts) return "";
  return extractTextFromParts(content.parts);
}

// ── Session file discovery ──────────────────────────────────────────────────

async function findSessionFiles(ctx: AgentChatParserContext): Promise<string[]> {
  const results: string[] = [];
  const qwenProjectsDir = getQwenProjectsDir();

  if (!fs.existsSync(qwenProjectsDir)) return results;

  for (const projectDir of listSubdirectories(ctx, qwenProjectsDir)) {
    const chatsDir = path.join(projectDir, "chats");
    if (!fs.existsSync(chatsDir)) continue;

    try {
      const entries = fs.readdirSync(chatsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          results.push(path.join(chatsDir, entry.name));
        }
      }
    } catch (err) {
      ctx.log.debug("qwen-code: error reading chats dir", chatsDir, err);
    }
  }

  return results;
}

// ── Session metadata extraction ─────────────────────────────────────────────

async function extractSessionMeta(
  ctx: AgentChatParserContext,
  filePath: string,
): Promise<QwenSessionMeta | null> {
  let fileStat: fs.Stats;
  try {
    fileStat = await fs.promises.stat(filePath);
  } catch (err) {
    ctx.log.debug("qwen-code: failed to stat session file", filePath, err);
    return null;
  }

  let sessionId = "";
  let cwd = "";
  let gitBranch: string | undefined;
  let hasVisibleUserMessage = false;
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;
  let model: string | undefined;

  await scanJsonlLines(
    ctx,
    filePath,
    (line, lineIndex) => {
      const trimmed = line.trim();
      if (!trimmed) return "continue";

      const chunks = splitJsonObjects(line);
      for (const chunk of chunks) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(chunk);
        } catch {
          continue;
        }

        const record = parseQwenChatRecord(ctx, parsed, filePath, lineIndex);
        if (!record) continue;

        if (!sessionId && record.sessionId) sessionId = record.sessionId;
        if (!cwd && record.cwd) cwd = record.cwd;
        if (!gitBranch && record.gitBranch) gitBranch = record.gitBranch;
        if (!model && record.model) model = record.model;

        if (!firstTimestamp && record.timestamp) firstTimestamp = record.timestamp;
        if (record.timestamp) lastTimestamp = record.timestamp;

        if (record.type === "user" && !hasVisibleUserMessage) {
          hasVisibleUserMessage = extractContentText(record.message).length > 0;
        }
      }
      return "continue";
    },
    { maxLineChars: MAX_QWEN_JSONL_RECORD_CHARS },
  );

  if (!sessionId) return null;

  return {
    sessionId,
    cwd,
    gitBranch,
    hasVisibleUserMessage,
    firstTimestamp,
    lastTimestamp,
    model,
    mtime: fileStat.mtime,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

function aggregateRecordGroup(records: QwenChatRecord[]): QwenChatRecord {
  const base: QwenChatRecord = { ...records[0]! };

  for (const record of records.slice(1)) {
    if (record.message) {
      base.message = {
        role: base.message?.role ?? record.message.role,
        parts: [...(base.message?.parts ?? []), ...(record.message.parts ?? [])],
      };
    }

    if (record.model && !base.model) base.model = record.model;
    if (record.timestamp > base.timestamp) base.timestamp = record.timestamp;
  }

  return base;
}

function aggregateRecordsByUuid(records: QwenChatRecord[]): QwenChatRecord[] {
  const groups = new Map<string, QwenChatRecord[]>();
  const order: string[] = [];

  for (const record of records) {
    if (!groups.has(record.uuid)) {
      groups.set(record.uuid, []);
      order.push(record.uuid);
    }
    groups.get(record.uuid)!.push(record);
  }

  return order.map((uuid) => aggregateRecordGroup(groups.get(uuid)!));
}

function getLastMainRecordUuid(records: QwenChatRecord[]): string | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (record && !getBooleanField(record, "isSidechain")) return record.uuid;
  }
  return records.at(-1)?.uuid;
}

/**
 * Reconstruct the main conversation path by walking parentUuid backwards from
 * the last appended non-sidechain record. Mirrors upstream Qwen Code's
 * `sessionService.reconstructHistory` (packages/core/src/services/sessionService.ts)
 * which starts at `records[records.length - 1].uuid` (or a supplied leafUuid)
 * and walks parents until the chain breaks.
 *
 * **Broken-chain policy:** when a parentUuid does not resolve in the current
 * record set (incomplete log, deleted ancestor, or fork merge artefacts), we
 * fall back to the full append-ordered `aggregated` set instead of truncating
 * at the last valid ancestor. Upstream truncates because it owns the live
 * session. We're a *handoff* — surfacing every appended turn keeps the
 * receiving tool from silently losing work the user could see in Qwen Code's
 * UI. The trade-off is that abandoned branches reappear on broken chains;
 * that is the lesser evil for a one-shot context dump (open question #2 in
 * the PR description, resolved deliberately).
 *
 * Cycle protection: `visited` guard breaks if a parent loop is detected.
 */
function reconstructMainPath(records: QwenChatRecord[]): QwenChatRecord[] {
  if (records.length === 0) return [];

  const aggregated = aggregateRecordsByUuid(records);
  const byUuid = new Map(aggregated.map((record) => [record.uuid, record]));
  const startUuid = getLastMainRecordUuid(records);
  if (!startUuid) return aggregated;

  const pathResult: QwenChatRecord[] = [];
  const visited = new Set<string>();
  let current = byUuid.get(startUuid);
  let brokenChain = false;

  while (current) {
    if (visited.has(current.uuid)) {
      brokenChain = true;
      break;
    }
    visited.add(current.uuid);
    pathResult.unshift(current);
    if (!current.parentUuid) break;
    const parent = byUuid.get(current.parentUuid);
    if (!parent) {
      brokenChain = true;
      break;
    }
    current = parent;
  }

  return brokenChain || pathResult.length === 0 ? aggregated : pathResult;
}

export async function parseQwenCodeSessions(
  ctx: AgentChatParserContext,
): Promise<UnifiedSession[]> {
  const files = await findSessionFiles(ctx);
  const sessions: UnifiedSession[] = [];

  for (const filePath of files) {
    try {
      const meta = await extractSessionMeta(ctx, filePath);
      if (!meta) continue;

      if (!meta.hasVisibleUserMessage) continue;

      sessions.push({
        id: meta.sessionId,
        source: "qwen-code",
        cwd: meta.cwd,
        repo: extractRepoFromCwd(meta.cwd),
        branch: meta.gitBranch,
        createdAt: parseTimestamp(meta.firstTimestamp, meta.mtime),
        updatedAt: parseTimestamp(meta.lastTimestamp, meta.mtime),
        originalPath: filePath,
        model: meta.model,
      });
    } catch (err) {
      ctx.log.debug("qwen-code: skipping unparseable session", filePath, err);
    }
  }

  return sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export async function extractQwenCodeContext(
  ctx: AgentChatParserContext,
  session: UnifiedSession,
): Promise<ParsedAgentConversation> {
  const records = await readJsonlRecords(ctx, session.originalPath);
  const messages: MessageDraft[] = [];
  let model = session.model;

  const mainPath = reconstructMainPath(records);
  const messageRecords = mainPath.filter((r) => r.type === "user" || r.type === "assistant");
  for (const record of messageRecords) {
    if (record.model && !model) model = record.model;

    const text = extractContentText(record.message);
    if (!text) continue;

    messages.push({
      role: record.type === "user" ? "user" : "assistant",
      content: text,
      timestamp: new Date(record.timestamp),
    });
  }

  return {
    session: model ? { ...session, model } : session,
    messages: sequenceMessages(messages),
  };
}
