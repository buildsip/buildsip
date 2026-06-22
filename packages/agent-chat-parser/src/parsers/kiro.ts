import * as fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { AgentChatParserContext, ParsedAgentConversation, SessionParseOptions, UnifiedSession } from '../types/index';
import { findFiles, listSubdirectories, mapConcurrent } from '../utils/fs-helpers';
import { readJsonlFile } from '../utils/jsonl';
import { extractRepoFromCwd, homeDir, type MessageDraft, sequenceMessages } from '../utils/parser-helpers';
import { matchesCwd } from '../utils/slug';

// ── Kiro Storage ────────────────────────────────────────────────────────────

const KIRO_AGENT_RELATIVE_PATH = ['User', 'globalStorage', 'kiro.kiroagent', 'workspace-sessions'];
// Canonical ACP `session/update` discriminator values per the agent-client-protocol schema:
//   https://github.com/zed-industries/agent-client-protocol/blob/main/schema/schema.json
// Verified against Kiro CLI v1.29.0 docs (kiro.dev/docs/cli/acp/) and the empirical reference at
//   https://github.com/dwalleck/cyril/blob/main/docs/kiro-acp-protocol.md
const ACP_SESSION_UPDATE_KEYS = ['sessionUpdate', 'type', 'kind', 'updateType', 'eventType'] as const;
const ACP_AGENT_MESSAGE_CHUNK = new Set(['agent_message_chunk', 'AgentMessageChunk']);
const ACP_AGENT_THOUGHT_CHUNK = new Set(['agent_thought_chunk', 'AgentThoughtChunk']);
const ACP_USER_MESSAGE_CHUNK = new Set(['user_message_chunk', 'UserMessageChunk']);
const ACP_AGENT_MESSAGE = new Set(['agent_message', 'AgentMessage']);
const ACP_USER_MESSAGE = new Set(['user_message', 'UserMessage']);
// The canonical ACP spec has no `TurnEnd` event — turns end via the JSON-RPC response to
// `session/prompt` with `stopReason: end_turn`. We still recognise the legacy fixture name
// so synthesised `TurnEnd` events keep flushing accumulators harmlessly.
const ACP_TURN_END = new Set(['turn_end', 'TurnEnd']);

type KiroSurface = 'ide-workspace' | 'acp-jsonl';

interface KiroSessionRef {
  surface: KiroSurface;
  workspaceDir: string;
  workspacePath?: string;
  sessionPath: string;
  eventPath?: string;
  indexPath?: string;
  indexEntry?: JsonRecord;
}

type JsonRecord = Record<string, unknown>;
type KiroStatInfo = { stats: Pick<fs.Stats, 'size' | 'birthtime' | 'mtime'>; originalPath: string };

function getKiroWorkspaceSessionDirs(): string[] {
  const home = homeDir();
  const observedDirs = [
    path.join(home, 'Library', 'Application Support', 'Kiro', ...KIRO_AGENT_RELATIVE_PATH),
    path.join(home, '.config', 'Kiro', ...KIRO_AGENT_RELATIVE_PATH),
    path.join(home, 'AppData', 'Roaming', 'Kiro', ...KIRO_AGENT_RELATIVE_PATH),
  ];

  // Older parser revisions used this path. Keep it as a read-only fallback.
  const legacyDirs = [path.join(home, 'Library', 'Application Support', 'Kiro', 'workspace-sessions')];

  return Array.from(new Set([...observedDirs, ...legacyDirs])).filter((dir) => fs.existsSync(dir));
}

function getKiroAcpSessionDir(): string {
  return path.join(homeDir(), '.kiro', 'sessions', 'cli');
}

function isKiroAcpSessionPath(filePath: string): boolean {
  const sessionDir = path.dirname(filePath);
  return (
    path.basename(sessionDir) === 'cli' &&
    path.basename(path.dirname(sessionDir)) === 'sessions' &&
    path.basename(path.dirname(path.dirname(sessionDir))) === '.kiro'
  );
}

function getSiblingPath(filePath: string, extension: '.json' | '.jsonl'): string {
  return path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}${extension}`);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJsonFile(ctx: AgentChatParserContext, filePath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch (err) {
    ctx.log.debug('kiro: failed to parse json file', filePath, err);
    return undefined;
  }
}

function getString(record: JsonRecord | undefined, keys: readonly string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

function getRecord(record: JsonRecord | undefined, keys: readonly string[]): JsonRecord | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) return value;
  }
  return undefined;
}

function parseDateValue(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 0 && value < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return parseDateValue(numeric);

    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  return undefined;
}

function getDate(record: JsonRecord | undefined, keys: readonly string[]): Date | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const parsed = parseDateValue(record[key]);
    if (parsed) return parsed;
  }
  return undefined;
}

function decodeWorkspaceFolderName(ctx: AgentChatParserContext, folderName: string): string | undefined {
  const normalized = folderName.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  try {
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const trimmed = decoded.trim();
    if (
      trimmed.startsWith('/') ||
      trimmed.startsWith('~') ||
      trimmed.startsWith('file:') ||
      /^[A-Za-z]:[\\/]/.test(trimmed)
    ) {
      return trimmed;
    }
    return undefined;
  } catch (err) {
    ctx.log.debug('kiro: failed to decode workspace folder', folderName, err);
    return undefined;
  }
}

function parseSessionIndex(data: unknown): JsonRecord[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (!isRecord(data)) return [];

  const candidates = [data.sessions, data.entries, data.items];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter(isRecord);
  }

  return [];
}

async function readSessionIndex(ctx: AgentChatParserContext, indexPath: string): Promise<JsonRecord[]> {
  if (!fs.existsSync(indexPath)) return [];
  return parseSessionIndex(await readJsonFile(ctx, indexPath));
}

async function discoverSessionRefs(ctx: AgentChatParserContext): Promise<KiroSessionRef[]> {
  const refs: KiroSessionRef[] = [];

  for (const baseDir of getKiroWorkspaceSessionDirs()) {
    for (const workspaceDir of listSubdirectories(ctx, baseDir)) {
      const workspacePath = decodeWorkspaceFolderName(ctx, path.basename(workspaceDir));
      const indexedSessionPaths = new Set<string>();
      const indexPath = path.join(workspaceDir, 'sessions.json');

      for (const entry of await readSessionIndex(ctx, indexPath)) {
        const sessionId = getString(entry, ['sessionId', 'id', 'conversationId']);
        if (!sessionId) continue;

        const sessionPath = path.join(workspaceDir, `${sessionId}.json`);
        indexedSessionPaths.add(path.resolve(sessionPath));
        refs.push({
          surface: 'ide-workspace',
          workspaceDir,
          workspacePath,
          sessionPath,
          indexPath,
          indexEntry: entry,
        });
      }

      const looseSessionFiles = findFiles(ctx, workspaceDir, {
        match: (entry) => entry.name.endsWith('.json') && entry.name !== 'sessions.json',
        recursive: false,
      });

      for (const sessionPath of looseSessionFiles) {
        if (indexedSessionPaths.has(path.resolve(sessionPath))) continue;
        refs.push({ surface: 'ide-workspace', workspaceDir, workspacePath, sessionPath });
      }
    }
  }

  const acpDir = getKiroAcpSessionDir();
  if (fs.existsSync(acpDir)) {
    const metadataFiles = findFiles(ctx, acpDir, {
      match: (entry) => entry.name.endsWith('.json'),
      recursive: false,
    });
    const metadataPaths = new Set(metadataFiles.map((filePath) => path.resolve(filePath)));

    for (const sessionPath of metadataFiles) {
      const eventPath = getSiblingPath(sessionPath, '.jsonl');
      refs.push({
        surface: 'acp-jsonl',
        workspaceDir: acpDir,
        sessionPath,
        eventPath: fs.existsSync(eventPath) ? eventPath : undefined,
      });
    }

    const eventFiles = findFiles(ctx, acpDir, {
      match: (entry) => entry.name.endsWith('.jsonl'),
      recursive: false,
    });
    for (const eventPath of eventFiles) {
      const metadataPath = getSiblingPath(eventPath, '.json');
      if (metadataPaths.has(path.resolve(metadataPath))) continue;
      refs.push({
        surface: 'acp-jsonl',
        workspaceDir: acpDir,
        sessionPath: eventPath,
        eventPath,
      });
    }
  }

  return refs;
}

function getHistoryEntries(sessionData: JsonRecord | undefined): unknown[] {
  if (!sessionData) return [];
  if (Array.isArray(sessionData.history)) return sessionData.history;
  if (Array.isArray(sessionData.messages)) return sessionData.messages;
  return [];
}

function normalizeRole(role: unknown): MessageDraft['role'] | undefined {
  if (role === 'user' || role === 'human') return 'user';
  if (role === 'assistant' || role === 'ai') return 'assistant';
  return undefined;
}

function extractBlockText(block: unknown): string {
  if (!isRecord(block)) return '';

  const type = typeof block.type === 'string' ? block.type : undefined;
  const kind = typeof block.kind === 'string' ? block.kind : undefined;
  const hasBlockKind = type !== undefined || kind !== undefined;
  if (hasBlockKind && type !== 'text' && kind !== 'text') return '';

  if (typeof block.text === 'string') return block.text;
  if (typeof block.data === 'string') return block.data;
  return '';
}

function extractContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(extractBlockText).filter(Boolean).join('\n');
  if (isRecord(content)) {
    const blockText = extractBlockText(content);
    if (blockText) return blockText;

    for (const key of ['content', 'text', 'data', 'message', 'delta', 'chunk']) {
      const nested: unknown = content[key];
      if (nested === content) continue;
      const nestedText = extractContent(nested);
      if (nestedText) return nestedText;
    }
  }
  return '';
}

function normalizeHistoryEntry(entry: unknown): MessageDraft | undefined {
  if (!isRecord(entry)) return undefined;
  const message = isRecord(entry.message) ? entry.message : entry;
  const role = normalizeRole(message.role ?? entry.role);
  if (!role) return undefined;

  const content = extractContent(message.content ?? message.text ?? entry.content).trim();
  if (!content) return undefined;

  return {
    role,
    content,
    timestamp:
      getDate(message, ['timestamp', 'createdAt', 'dateCreated']) ?? getDate(entry, ['timestamp', 'createdAt']),
  };
}

function extractMessages(sessionData: JsonRecord | undefined): MessageDraft[] {
  return getHistoryEntries(sessionData).flatMap((entry) => {
    const message = normalizeHistoryEntry(entry);
    return message ? [message] : [];
  });
}

async function readAcpEvents(ctx: AgentChatParserContext, eventPath: string | undefined): Promise<unknown[]> {
  if (!eventPath || !fs.existsSync(eventPath)) return [];
  return readJsonlFile(ctx, eventPath);
}

function getAcpUpdate(record: JsonRecord): JsonRecord | undefined {
  const params = getRecord(record, ['params']);
  const update = getRecord(params, ['update']);
  if (update) return update;

  const nested = getRecord(record, ['update', 'event']);
  if (nested) return nested;

  return getAcpRecordType(record) ? record : undefined;
}

function getAcpRecordType(record: JsonRecord | undefined): string | undefined {
  return getString(record, ACP_SESSION_UPDATE_KEYS);
}

function extractAcpRecordText(record: JsonRecord | undefined): string {
  if (!record) return '';
  for (const key of ['content', 'text', 'message', 'delta', 'chunk', 'data']) {
    if (!(key in record)) continue;
    const text = extractContent(record[key]);
    if (text.length > 0 || typeof record[key] === 'string') return text;
  }
  return '';
}

function extractPromptText(record: JsonRecord): string {
  const params = getRecord(record, ['params']);
  return extractAcpRecordText(params).trim();
}

function extractAcpTimestamp(record: JsonRecord, fallback?: JsonRecord): Date | undefined {
  return (
    getDate(record, ['timestamp', 'createdAt', 'dateCreated', 'time']) ??
    getDate(fallback, ['timestamp', 'createdAt', 'dateCreated', 'time'])
  );
}

// Kiro CLI persists session history in `~/.kiro/sessions/cli/<id>.jsonl` using
// envelope objects keyed by `AssistantMessage` / `UserMessage` / `ToolResults`,
// not raw ACP `session/update` notifications (see kirodotdev/Kiro#6110). We
// peel the envelope so the same parser handles both wire-protocol replay logs
// and Kiro's persisted record format.
const KIRO_PERSISTED_ENVELOPE_KEYS = ['AssistantMessage', 'UserMessage', 'assistantMessage', 'userMessage'] as const;

function unwrapKiroPersistedEnvelope(
  event: JsonRecord,
): { kind: 'assistant' | 'user'; payload: JsonRecord } | undefined {
  for (const key of KIRO_PERSISTED_ENVELOPE_KEYS) {
    const value = event[key];
    if (!isRecord(value)) continue;
    const lowered = key.toLowerCase();
    if (lowered === 'assistantmessage') return { kind: 'assistant', payload: value };
    if (lowered === 'usermessage') return { kind: 'user', payload: value };
  }
  return undefined;
}

function extractAcpMessages(events: readonly unknown[]): MessageDraft[] {
  const messages: MessageDraft[] = [];
  let pendingAssistant = '';
  let pendingAssistantTimestamp: Date | undefined;
  let pendingUser = '';
  let pendingUserTimestamp: Date | undefined;
  // Track JSON-RPC `session/prompt` request ids so we can flush on the
  // matching response (`stopReason` carries model stop reasons such as `end_turn` or `cancelled`).
  const promptRequestIds = new Set<string>();

  const flushAssistant = (): void => {
    const content = pendingAssistant;
    pendingAssistant = '';
    const timestamp = pendingAssistantTimestamp;
    pendingAssistantTimestamp = undefined;
    if (content.trim().length === 0) return;
    messages.push({ role: 'assistant', content: content.trim(), timestamp });
  };

  const flushUser = (): void => {
    const content = pendingUser;
    pendingUser = '';
    const timestamp = pendingUserTimestamp;
    pendingUserTimestamp = undefined;
    if (content.trim().length === 0) return;
    messages.push({ role: 'user', content: content.trim(), timestamp });
  };

  const isPromptResponse = (event: JsonRecord): boolean => {
    if (typeof event.method === 'string') return false;
    const id = event.id;
    if (id === undefined || id === null) return false;
    const idKey = String(id);
    if (!promptRequestIds.has(idKey)) return false;
    promptRequestIds.delete(idKey);
    return true;
  };

  for (const event of events) {
    if (!isRecord(event)) continue;

    // Kiro CLI persisted-format envelopes (`AssistantMessage`/`UserMessage`).
    const persisted = unwrapKiroPersistedEnvelope(event);
    if (persisted) {
      if (persisted.kind === 'user') {
        flushAssistant();
        flushUser();
        const content = extractAcpRecordText(persisted.payload).trim();
        if (content) {
          messages.push({
            role: 'user',
            content,
            timestamp: extractAcpTimestamp(persisted.payload, event),
          });
        }
        continue;
      }
      // assistant
      flushAssistant();
      flushUser();
      const content = extractAcpRecordText(persisted.payload).trim();
      if (content) {
        messages.push({
          role: 'assistant',
          content,
          timestamp: extractAcpTimestamp(persisted.payload, event),
        });
      }
      continue;
    }

    const method = getString(event, ['method']);
    if (method === 'session/prompt') {
      flushAssistant();
      flushUser();
      const id = event.id;
      if (id !== undefined && id !== null) promptRequestIds.add(String(id));
      const content = extractPromptText(event);
      if (content) {
        messages.push({
          role: 'user',
          content,
          timestamp: extractAcpTimestamp(event, getRecord(event, ['params'])),
        });
      }
      continue;
    }

    // The ACP `session/prompt` JSON-RPC response (correlated to a tracked id) signals
    // turn end via `stopReason`. Flush any streaming assistant accumulator.
    if (isPromptResponse(event)) {
      flushAssistant();
      continue;
    }

    const update = getAcpUpdate(event);
    if (!update) {
      const directMessage = normalizeHistoryEntry(event);
      if (directMessage) {
        if (directMessage.role === 'user') {
          flushAssistant();
          flushUser();
        }
        messages.push(directMessage);
      }
      continue;
    }

    const updateType = getAcpRecordType(update);

    if (updateType && ACP_AGENT_MESSAGE_CHUNK.has(updateType)) {
      const chunk = extractAcpRecordText(update);
      if (chunk.length > 0) {
        // Starting a new assistant turn flushes any pending streamed user prompt.
        flushUser();
        pendingAssistant += chunk;
        pendingAssistantTimestamp ??= extractAcpTimestamp(update, event);
      }
      continue;
    }

    if (updateType && ACP_AGENT_THOUGHT_CHUNK.has(updateType)) {
      // Thought chunks are extended-thinking traces, not user-visible conversation per the
      // ACP schema. Skip them so they don't pollute the main message stream.
      continue;
    }

    if (updateType && ACP_USER_MESSAGE_CHUNK.has(updateType)) {
      const chunk = extractAcpRecordText(update);
      if (chunk.length > 0) {
        flushAssistant();
        pendingUser += chunk;
        pendingUserTimestamp ??= extractAcpTimestamp(update, event);
      }
      continue;
    }

    if (updateType && ACP_AGENT_MESSAGE.has(updateType)) {
      flushAssistant();
      flushUser();
      const content = extractAcpRecordText(update).trim();
      if (content) {
        messages.push({
          role: 'assistant',
          content,
          timestamp: extractAcpTimestamp(update, event),
        });
      }
      continue;
    }

    if (updateType && ACP_USER_MESSAGE.has(updateType)) {
      flushAssistant();
      flushUser();
      const content = extractAcpRecordText(update).trim();
      if (content) {
        messages.push({
          role: 'user',
          content,
          timestamp: extractAcpTimestamp(update, event),
        });
      }
      continue;
    }

    if (updateType && ACP_TURN_END.has(updateType)) {
      flushAssistant();
      flushUser();
      continue;
    }

    const directMessage = normalizeHistoryEntry(update);
    if (directMessage) {
      if (directMessage.role === 'user') {
        flushAssistant();
        flushUser();
      }
      messages.push(directMessage);
    }
  }

  flushAssistant();
  flushUser();
  return messages;
}

function extractAcpCwd(sessionData: JsonRecord | undefined, events: readonly unknown[]): string {
  const metadataCwd = getString(sessionData, ['workspacePath', 'workspace', 'cwd', 'workingDirectory', 'directory']);
  if (metadataCwd) return metadataCwd;

  for (const event of events) {
    if (!isRecord(event)) continue;
    if (getString(event, ['method']) !== 'session/new') continue;

    const cwd = getString(getRecord(event, ['params']), ['cwd', 'workspacePath', 'workingDirectory', 'directory']);
    if (cwd) return cwd;
  }

  return '';
}

function extractAcpModel(sessionData: JsonRecord | undefined, events: readonly unknown[]): string | undefined {
  // Kiro v1.29.0 added `models.currentModelId` in `session/new`; honour it after metadata.
  const metadataModel = getString(sessionData, ['selectedModel', 'model', 'modelId']);
  if (metadataModel) return metadataModel;
  const modelsBlock = getRecord(sessionData, ['models']);
  const currentMetadataModel = getString(modelsBlock, ['currentModelId', 'modelId']);
  if (currentMetadataModel) return currentMetadataModel;

  for (const event of events) {
    if (!isRecord(event)) continue;

    const params = getRecord(event, ['params']);
    const model = getString(params, ['model', 'modelId', 'selectedModel']);
    if (model) return model;

    // Inspect `session/new` and `session/load` responses (`{result: {models: {...}}}`).
    const result = getRecord(event, ['result']);
    const resultModels = getRecord(result, ['models']);
    const fromResult = getString(resultModels, ['currentModelId', 'modelId']);
    if (fromResult) return fromResult;
  }

  return undefined;
}

function getSessionId(ref: KiroSessionRef, sessionData: JsonRecord | undefined): string | undefined {
  return (
    getString(ref.indexEntry, ['sessionId', 'id', 'conversationId']) ??
    getString(sessionData, ['sessionId', 'id', 'conversationId']) ??
    path.basename(ref.sessionPath, path.extname(ref.sessionPath))
  );
}

function getWorkspacePath(ref: KiroSessionRef, sessionData: JsonRecord | undefined): string {
  return (
    getString(sessionData, ['workspacePath', 'workspace', 'cwd', 'directory']) ??
    getString(ref.indexEntry, ['workspacePath', 'workspace', 'cwd', 'directory']) ??
    ref.workspacePath ??
    ''
  );
}

function getModel(ref: KiroSessionRef, sessionData: JsonRecord | undefined): string | undefined {
  return getString(sessionData, ['selectedModel', 'model']) ?? getString(ref.indexEntry, ['selectedModel', 'model']);
}

async function statSessionRef(
  ctx: AgentChatParserContext,
  ref: KiroSessionRef,
): Promise<KiroStatInfo | undefined> {
  try {
    if (ref.surface === 'acp-jsonl') {
      const candidatePaths = [ref.sessionPath, ref.eventPath].filter((filePath): filePath is string => {
        if (!filePath) return false;
        return fs.existsSync(filePath);
      });
      // De-dupe so lone-jsonl refs (where sessionPath === eventPath) do not double-count bytes.
      const paths = Array.from(new Set(candidatePaths.map((filePath) => path.resolve(filePath))));
      if (paths.length === 0) return undefined;

      const stats = await Promise.all(paths.map((filePath) => fsp.stat(filePath)));
      const aggregateStats = {
        size: stats.reduce((total, stat) => total + stat.size, 0),
        birthtime: new Date(Math.min(...stats.map((stat) => stat.birthtime.getTime()))),
        mtime: new Date(Math.max(...stats.map((stat) => stat.mtime.getTime()))),
      };
      return { stats: aggregateStats, originalPath: ref.sessionPath };
    }

    if (fs.existsSync(ref.sessionPath)) {
      return { stats: await fsp.stat(ref.sessionPath), originalPath: ref.sessionPath };
    }
    if (ref.indexPath && fs.existsSync(ref.indexPath)) {
      return { stats: await fsp.stat(ref.indexPath), originalPath: ref.indexPath };
    }
  } catch (err) {
    ctx.log.debug('kiro: failed to stat session ref', ref.sessionPath, err);
  }
  return undefined;
}

async function parseAcpSessionRef(
  ctx: AgentChatParserContext,
  ref: KiroSessionRef,
  options: SessionParseOptions,
): Promise<UnifiedSession | null> {
  const sessionData = ref.sessionPath.endsWith('.json') ? await readJsonFile(ctx, ref.sessionPath) : undefined;
  if (ref.sessionPath.endsWith('.json') && sessionData === undefined) return null;

  const sessionRecord = isRecord(sessionData) ? sessionData : undefined;
  const events = await readAcpEvents(ctx, ref.eventPath);
  const sessionId = getSessionId(ref, sessionRecord);
  if (!sessionId) return null;

  const statInfo = await statSessionRef(ctx, ref);
  if (!statInfo) return null;

  const cwd = extractAcpCwd(sessionRecord, events);
  if (options.cwd && cwd && !matchesCwd(cwd, options.cwd)) return null;

  const createdAt =
    getDate(sessionRecord, ['dateCreated', 'createdAt', 'creationDate']) ??
    getDate(getRecord(sessionRecord, ['metadata']), ['dateCreated', 'createdAt', 'creationDate']) ??
    statInfo.stats.birthtime;
  const updatedAt =
    getDate(sessionRecord, ['dateUpdated', 'updatedAt', 'lastUpdatedAt', 'lastMessageDate']) ??
    getDate(getRecord(sessionRecord, ['metadata']), ['dateUpdated', 'updatedAt', 'lastUpdatedAt', 'lastMessageDate']) ??
    statInfo.stats.mtime;

  return {
    id: sessionId,
    source: 'kiro',
    cwd,
    repo: extractRepoFromCwd(cwd) || undefined,
    createdAt,
    updatedAt,
    originalPath: statInfo.originalPath,
    model: extractAcpModel(sessionRecord, events),
  };
}

async function parseSessionRef(
  ctx: AgentChatParserContext,
  ref: KiroSessionRef,
  options: SessionParseOptions,
): Promise<UnifiedSession | null> {
  if (ref.surface === 'acp-jsonl') return parseAcpSessionRef(ctx, ref, options);

  const sessionFileExists = fs.existsSync(ref.sessionPath);
  const sessionData = sessionFileExists ? await readJsonFile(ctx, ref.sessionPath) : undefined;
  if (sessionFileExists && sessionData === undefined && !ref.indexEntry) return null;

  const sessionRecord = isRecord(sessionData) ? sessionData : undefined;
  const sessionId = getSessionId(ref, sessionRecord);
  if (!sessionId) return null;

  const statInfo = await statSessionRef(ctx, ref);
  if (!statInfo) return null;

  const cwd = getWorkspacePath(ref, sessionRecord);
  if (options.cwd && cwd && !matchesCwd(cwd, options.cwd)) return null;

  const createdAt =
    getDate(ref.indexEntry, ['dateCreated', 'createdAt', 'creationDate']) ??
    getDate(sessionRecord, ['dateCreated', 'createdAt', 'creationDate']) ??
    statInfo.stats.birthtime;
  const updatedAt =
    getDate(sessionRecord, ['dateUpdated', 'updatedAt', 'lastUpdatedAt', 'lastMessageDate']) ??
    getDate(ref.indexEntry, ['dateUpdated', 'updatedAt', 'lastUpdatedAt', 'lastMessageDate']) ??
    statInfo.stats.mtime;

  const model = getModel(ref, sessionRecord);

  return {
    id: sessionId,
    source: 'kiro',
    cwd,
    repo: extractRepoFromCwd(cwd) || undefined,
    createdAt,
    updatedAt,
    originalPath: statInfo.originalPath,
    model,
  };
}

/**
 * Parse all Kiro sessions into the unified format.
 */
export async function parseKiroSessions(
  ctx: AgentChatParserContext,
  options: SessionParseOptions = {},
): Promise<UnifiedSession[]> {
  const refs = await discoverSessionRefs(ctx);
  const parsedSessions = await mapConcurrent(refs, 16, async (ref) => {
    try {
      return await parseSessionRef(ctx, ref, options);
    } catch (err) {
      ctx.log.debug('kiro: skipping unparseable session', ref.sessionPath, err);
      return null;
    }
  });

  const sessionsById = new Map<string, UnifiedSession>();
  for (const session of parsedSessions) {
    if (!session) continue;
    const existing = sessionsById.get(session.id);
    if (!existing || existing.updatedAt.getTime() < session.updatedAt.getTime()) {
      sessionsById.set(session.id, session);
    }
  }

  const sorted = Array.from(sessionsById.values()).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return options.limit ? sorted.slice(0, options.limit) : sorted;
}

async function readSiblingIndexEntry(
  ctx: AgentChatParserContext,
  session: UnifiedSession,
): Promise<JsonRecord | undefined> {
  const indexPath =
    path.basename(session.originalPath) === 'sessions.json'
      ? session.originalPath
      : path.join(path.dirname(session.originalPath), 'sessions.json');

  const entries = await readSessionIndex(ctx, indexPath);
  return entries.find((entry) => getString(entry, ['sessionId', 'id', 'conversationId']) === session.id);
}

function resolveContextSessionPath(session: UnifiedSession): string {
  if (path.basename(session.originalPath) === 'sessions.json') {
    return path.join(path.dirname(session.originalPath), `${session.id}.json`);
  }
  return session.originalPath;
}

function resolveAcpContextPaths(session: UnifiedSession): { metadataPath?: string; eventPath?: string } {
  if (session.originalPath.endsWith('.jsonl')) {
    const metadataPath = getSiblingPath(session.originalPath, '.json');
    return {
      metadataPath: fs.existsSync(metadataPath) ? metadataPath : undefined,
      eventPath: session.originalPath,
    };
  }

  if (session.originalPath.endsWith('.json')) {
    const eventPath = getSiblingPath(session.originalPath, '.jsonl');
    return {
      metadataPath: session.originalPath,
      eventPath: fs.existsSync(eventPath) ? eventPath : undefined,
    };
  }

  return {};
}

/**
 * Extract visible messages from a Kiro session.
 */
export async function extractKiroContext(
  ctx: AgentChatParserContext,
  session: UnifiedSession,
): Promise<ParsedAgentConversation> {
  if (isKiroAcpSessionPath(session.originalPath)) {
    const paths = resolveAcpContextPaths(session);
    const sessionData = paths.metadataPath ? await readJsonFile(ctx, paths.metadataPath) : undefined;
    const sessionRecord = isRecord(sessionData) ? sessionData : undefined;
    const events = await readAcpEvents(ctx, paths.eventPath);
    const eventMessages = extractAcpMessages(events);
    const jsonMessages = extractMessages(sessionRecord);
    const messages = eventMessages.length > 0 ? eventMessages : jsonMessages;
    const cwd = extractAcpCwd(sessionRecord, events) || session.cwd;
    const model = extractAcpModel(sessionRecord, events) ?? session.model;
    const enrichedSession: UnifiedSession = {
      ...session,
      cwd,
      repo: session.repo || extractRepoFromCwd(cwd) || undefined,
      model,
    };
    return {
      session: enrichedSession,
      messages: sequenceMessages(messages),
    };
  }

  const sessionPath = resolveContextSessionPath(session);
  const sessionData = fs.existsSync(sessionPath) ? await readJsonFile(ctx, sessionPath) : undefined;
  const sessionRecord = isRecord(sessionData) ? sessionData : undefined;
  const indexEntry = await readSiblingIndexEntry(ctx, session);
  const workspacePath = getWorkspacePath(
    {
      surface: 'ide-workspace',
      workspaceDir: path.dirname(sessionPath),
      workspacePath: decodeWorkspaceFolderName(ctx, path.basename(path.dirname(sessionPath))),
      sessionPath,
      indexEntry,
    },
    sessionRecord,
  );
  const model = getModel(
    { surface: 'ide-workspace', workspaceDir: path.dirname(sessionPath), sessionPath, indexEntry },
    sessionRecord,
  );
  const messages = extractMessages(sessionRecord);
  const enrichedSession: UnifiedSession = {
    ...session,
    cwd: workspacePath || session.cwd,
    repo: session.repo || extractRepoFromCwd(workspacePath || session.cwd) || undefined,
    model: model ?? session.model,
  };

  return {
    session: enrichedSession,
    messages: sequenceMessages(messages),
  };
}
