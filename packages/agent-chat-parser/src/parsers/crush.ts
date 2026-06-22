import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { logger } from '../logger';
import type { ParsedAgentConversation, SessionParseOptions, UnifiedSession } from '../types/index';
import type { SessionSource } from '../types/tool-names';
import { extractRepoFromCwd, homeDir, type MessageDraft, sequenceMessages } from '../utils/parser-helpers';
import { matchesCwd } from '../utils/slug';

const require = createRequire(import.meta.url);

const CRUSH_SOURCE: SessionSource = 'crush';
const CRUSH_DB_FILE = 'crush.db';
const CRUSH_DATA_DIR = '.crush';

interface SqlitePreparedStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown | undefined;
}

interface SqliteDatabase {
  prepare(sql: string): SqlitePreparedStatement;
  close(): void;
}

interface DatabaseSyncConstructor {
  new (location: string, options?: { readOnly?: boolean }): SqliteDatabase;
}

interface CrushDbCandidate {
  dbPath: string;
  cwd: string;
}

interface CrushSchema {
  sessionColumns: ReadonlySet<string>;
  messageColumns: ReadonlySet<string>;
}

interface CrushSessionRow {
  id: string;
  title: string;
  sessionCreatedAt: number | undefined;
  sessionUpdatedAt: number | undefined;
  firstMessageAt: number | undefined;
  lastMessageAt: number | undefined;
  messageCount: number;
  latestModel: string | undefined;
}

interface CrushMessageRow {
  id: string;
  role: string;
  parts: string;
  createdAt: number | undefined;
  model: string | undefined;
  provider: string | undefined;
  isSummaryMessage: boolean;
}

interface ParsedCrushParts {
  text: string;
  malformed: boolean;
}

interface ParsedCrushMessage {
  row: CrushMessageRow;
  role: MessageDraft['role'] | 'tool';
  parts: ParsedCrushParts;
}

function getDatabaseSyncConstructor(): DatabaseSyncConstructor | undefined {
  try {
    const sqlite = require('node:sqlite') as { DatabaseSync: DatabaseSyncConstructor };
    return sqlite.DatabaseSync;
  } catch (err) {
    logger.debug('crush: node:sqlite is unavailable', err);
    return undefined;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (err) {
    const code = nodeErrorCode(err);
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      logger.debug('crush: path is not readable', filePath, err);
    }
    return false;
  }
}

async function openReadOnlyDatabase(dbPath: string): Promise<SqliteDatabase | undefined> {
  if (!(await pathExists(dbPath))) return undefined;

  const DatabaseSync = getDatabaseSyncConstructor();
  if (!DatabaseSync) return undefined;

  try {
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch (err) {
    logger.debug('crush: failed to open SQLite database read-only', dbPath, err);
    return undefined;
  }
}

function closeDatabase(db: SqliteDatabase, dbPath: string): void {
  try {
    db.close();
  } catch (err) {
    logger.debug('crush: failed to close SQLite database', dbPath, err);
  }
}

function expandHome(value: string): string {
  if (value === '~') return homeDir();
  if (value.startsWith('~/')) return path.join(homeDir(), value.slice(2));
  return value;
}

function inferCwdFromDbPath(dbPath: string): string {
  const dataDir = path.dirname(dbPath);
  if (path.basename(dataDir) === CRUSH_DATA_DIR) {
    return path.dirname(dataDir);
  }
  return '';
}

function addCandidate(
  candidates: CrushDbCandidate[],
  seen: Set<string>,
  dbPath: string | undefined,
  cwd?: string,
): void {
  if (!dbPath) return;
  const resolvedDbPath = path.resolve(expandHome(dbPath));
  if (seen.has(resolvedDbPath)) return;
  seen.add(resolvedDbPath);

  const resolvedCwd = cwd ? path.resolve(expandHome(cwd)) : inferCwdFromDbPath(resolvedDbPath);
  candidates.push({ dbPath: resolvedDbPath, cwd: resolvedCwd });
}

async function addCwdCandidates(
  candidates: CrushDbCandidate[],
  seen: Set<string>,
  cwd: string | undefined,
): Promise<void> {
  if (!cwd) return;

  let current = path.resolve(expandHome(cwd));
  while (true) {
    const dbPath = path.join(current, CRUSH_DATA_DIR, CRUSH_DB_FILE);
    addCandidate(candidates, seen, dbPath, current);
    if (await pathExists(dbPath)) return;

    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function crushGlobalDataPath(): string {
  if (process.env.CRUSH_GLOBAL_DATA) {
    return path.join(expandHome(process.env.CRUSH_GLOBAL_DATA), 'crush.json');
  }

  if (process.env.XDG_DATA_HOME) {
    return path.join(expandHome(process.env.XDG_DATA_HOME), 'crush', 'crush.json');
  }

  return path.join(homeDir(), '.local', 'share', 'crush', 'crush.json');
}

async function addProjectIndexCandidates(candidates: CrushDbCandidate[], seen: Set<string>): Promise<void> {
  const projectsPath = path.join(path.dirname(crushGlobalDataPath()), 'projects.json');

  try {
    const raw = await fs.readFile(projectsPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.projects)) return;

    for (const project of parsed.projects) {
      if (!isRecord(project)) continue;
      const projectPath = stringValue(project, 'path');
      const dataDir = stringValue(project, 'data_dir');
      if (!dataDir) continue;
      addCandidate(candidates, seen, path.join(dataDir, CRUSH_DB_FILE), projectPath);
    }
  } catch (err) {
    const code = nodeErrorCode(err);
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      logger.debug('crush: failed to inspect projects index', projectsPath, err);
    }
  }
}

async function getCrushDbCandidates(options?: SessionParseOptions): Promise<CrushDbCandidate[]> {
  const candidates: CrushDbCandidate[] = [];
  const seen = new Set<string>();
  const explicitDb = process.env.CRUSH_DB || process.env.CRUSH_DB_PATH;

  if (explicitDb) {
    addCandidate(candidates, seen, explicitDb);
    return candidates;
  }

  if (process.env.CRUSH_DATA_DIR) {
    addCandidate(candidates, seen, path.join(process.env.CRUSH_DATA_DIR, CRUSH_DB_FILE));
  }

  await addProjectIndexCandidates(candidates, seen);
  await addCwdCandidates(candidates, seen, options?.cwd);
  if (options?.cwd !== process.cwd()) {
    await addCwdCandidates(candidates, seen, process.cwd());
  }
  addCandidate(candidates, seen, path.join(homeDir(), CRUSH_DATA_DIR, CRUSH_DB_FILE));

  return candidates;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nodeErrorCode(err: unknown): string | undefined {
  if (!isRecord(err)) return undefined;
  const code = err.code;
  return typeof code === 'string' ? code : undefined;
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function numberValue(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function booleanValue(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'bigint') return value !== 0n;
  if (typeof value === 'string') {
    if (value === '1' || value.toLowerCase() === 'true') return true;
    if (value === '0' || value.toLowerCase() === 'false') return false;
  }
  return undefined;
}

function safeAll(db: SqliteDatabase, sql: string, params: unknown[], label: string): unknown[] {
  try {
    return db.prepare(sql).all(...params);
  } catch (err) {
    logger.debug(`crush: failed to query ${label}`, err);
    return [];
  }
}

function safeGet(db: SqliteDatabase, sql: string, params: unknown[], label: string): unknown | undefined {
  try {
    return db.prepare(sql).get(...params);
  } catch (err) {
    logger.debug(`crush: failed to query ${label}`, err);
    return undefined;
  }
}

function columnNames(db: SqliteDatabase, tableName: 'sessions' | 'messages'): Set<string> {
  const rows = safeAll(db, `PRAGMA table_info(${tableName})`, [], `${tableName} columns`);
  const names = new Set<string>();

  for (const row of rows) {
    if (!isRecord(row)) continue;
    const name = stringValue(row, 'name');
    if (name) names.add(name);
  }

  return names;
}

function getSchema(db: SqliteDatabase): CrushSchema | undefined {
  const sessionColumns = columnNames(db, 'sessions');
  const messageColumns = columnNames(db, 'messages');

  if (!sessionColumns.has('id') || !messageColumns.has('session_id')) {
    return undefined;
  }

  return { sessionColumns, messageColumns };
}

function selectColumn(columns: ReadonlySet<string>, column: string, fallback: string, alias: string): string {
  return columns.has(column) ? `${column} AS ${alias}` : `${fallback} AS ${alias}`;
}

function selectQualifiedColumn(
  columns: ReadonlySet<string>,
  qualifier: string,
  column: string,
  fallback: string,
  alias: string,
): string {
  return columns.has(column) ? `${qualifier}.${column} AS ${alias}` : `${fallback} AS ${alias}`;
}

function messageOrderBy(schema: CrushSchema, direction: 'ASC' | 'DESC' = 'ASC'): string {
  const parts: string[] = [];
  if (schema.messageColumns.has('created_at')) parts.push(`created_at ${direction}`);
  parts.push(schema.messageColumns.has('id') ? `id ${direction}` : `rowid ${direction}`);
  return parts.join(', ');
}

function sessionTimestampExpression(schema: CrushSchema, column: 'created_at' | 'updated_at'): string {
  return schema.sessionColumns.has(column) ? `s.${column}` : 'NULL';
}

function matchesCrushCwd(candidateCwd: string, targetCwd: string): boolean {
  return matchesCwd(candidateCwd, targetCwd) || matchesCwd(targetCwd, candidateCwd);
}

function normalizeTimestamp(value: number | undefined): Date | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;

  // Current Crush SQL writes strftime('%s') and Go code uses time.Now().Unix().
  // Older comments mention milliseconds, so keep accepting both units.
  const millis = value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseSessionRow(row: unknown): CrushSessionRow | undefined {
  if (!isRecord(row)) return undefined;
  const id = stringValue(row, 'id');
  if (!id) return undefined;

  return {
    id,
    title: stringValue(row, 'title') ?? '',
    sessionCreatedAt: numberValue(row, 'sessionCreatedAt'),
    sessionUpdatedAt: numberValue(row, 'sessionUpdatedAt'),
    firstMessageAt: numberValue(row, 'firstMessageAt'),
    lastMessageAt: numberValue(row, 'lastMessageAt'),
    messageCount: numberValue(row, 'messageCount') ?? 0,
    latestModel: stringValue(row, 'latestModel'),
  };
}

function parseMessageRow(row: unknown): CrushMessageRow | undefined {
  if (!isRecord(row)) return undefined;
  const id = stringValue(row, 'id');
  const role = stringValue(row, 'role');
  if (!id || !role) return undefined;

  return {
    id,
    role,
    parts: stringValue(row, 'parts') ?? '[]',
    createdAt: numberValue(row, 'createdAt'),
    model: stringValue(row, 'model'),
    provider: stringValue(row, 'provider'),
    isSummaryMessage: booleanValue(row, 'isSummaryMessage') ?? false,
  };
}

function parseParts(partsJson: string): ParsedCrushParts {
  let parsed: unknown;
  try {
    parsed = JSON.parse(partsJson);
  } catch (err) {
    logger.debug('crush: failed to parse message parts JSON', err);
    return { text: '', malformed: true };
  }

  if (!Array.isArray(parsed)) {
    return { text: '', malformed: true };
  }

  const text: string[] = [];

  for (const part of parsed) {
    if (!isRecord(part)) continue;
    const type = stringValue(part, 'type');
    const data = isRecord(part.data) ? part.data : {};

    switch (type) {
      case 'text': {
        const value = stringValue(data, 'text') ?? stringValue(part, 'text');
        if (value) text.push(value);
        break;
      }
      default:
        break;
    }
  }

  return {
    text: text.join('\n').trim(),
    malformed: false,
  };
}

function normalizeRole(role: string): MessageDraft['role'] | 'tool' | undefined {
  switch (role) {
    case 'user':
    case 'assistant':
      return role;
    case 'tool':
      return 'tool';
    default:
      return undefined;
  }
}

/**
 * Build a correlated subquery expression that returns the requested column
 * (e.g. `model` or `provider`) from the latest non-summary assistant message
 * for the outer `s.id` session. Folding this into the main listing query
 * avoids per-session N+1 queries during `parseCrushSessions`.
 */
function buildLatestAssistantSubquery(schema: CrushSchema, column: 'model' | 'provider'): string {
  if (!schema.messageColumns.has('role') || !schema.messageColumns.has('model')) {
    return 'NULL';
  }
  if (column === 'provider' && !schema.messageColumns.has('provider')) {
    return 'NULL';
  }

  const summaryFilter = schema.messageColumns.has('is_summary_message')
    ? 'AND COALESCE(lm.is_summary_message, 0) = 0'
    : '';
  const orderParts: string[] = [];
  if (schema.messageColumns.has('created_at')) orderParts.push('lm.created_at DESC');
  orderParts.push(schema.messageColumns.has('id') ? 'lm.id DESC' : 'lm.rowid DESC');

  return `(
    SELECT lm.${column}
    FROM messages lm
    WHERE lm.session_id = s.id
      AND lm.role = 'assistant'
      AND lm.model IS NOT NULL
      AND lm.model != ''
      ${summaryFilter}
    ORDER BY ${orderParts.join(', ')}
    LIMIT 1
  )`;
}

function listSessionsFromDb(
  db: SqliteDatabase,
  candidate: CrushDbCandidate,
  options?: SessionParseOptions,
): UnifiedSession[] {
  const schema = getSchema(db);
  if (!schema) return [];

  const messageSummaryJoin = schema.messageColumns.has('is_summary_message')
    ? 'AND COALESCE(m.is_summary_message, 0) = 0'
    : '';
  const parentFilter = schema.sessionColumns.has('parent_session_id') ? 'WHERE s.parent_session_id IS NULL' : '';
  const firstMessageAt = schema.messageColumns.has('created_at') ? 'MIN(m.created_at)' : 'NULL';
  const lastMessageAt = schema.messageColumns.has('created_at') ? 'MAX(m.created_at)' : 'NULL';
  const messageCount = schema.messageColumns.has('id') ? 'COUNT(m.id)' : 'COUNT(m.session_id)';
  const sessionUpdatedAt = sessionTimestampExpression(schema, 'updated_at');
  const sessionCreatedAt = sessionTimestampExpression(schema, 'created_at');
  const orderMessageAt = schema.messageColumns.has('created_at') ? 'MAX(m.created_at)' : 'NULL';
  const orderBy = `COALESCE(${orderMessageAt}, ${sessionUpdatedAt}, ${sessionCreatedAt}, 0)`;
  const latestModelExpression = buildLatestAssistantSubquery(schema, 'model');
  const rows = safeAll(
    db,
    `SELECT
       s.id AS id,
       ${selectQualifiedColumn(schema.sessionColumns, 's', 'title', "''", 'title')},
       ${selectQualifiedColumn(schema.sessionColumns, 's', 'created_at', 'NULL', 'sessionCreatedAt')},
       ${selectQualifiedColumn(schema.sessionColumns, 's', 'updated_at', 'NULL', 'sessionUpdatedAt')},
       ${firstMessageAt} AS firstMessageAt,
       ${lastMessageAt} AS lastMessageAt,
       ${messageCount} AS messageCount,
       ${latestModelExpression} AS latestModel
     FROM sessions s
     LEFT JOIN messages m ON m.session_id = s.id ${messageSummaryJoin}
     ${parentFilter}
     GROUP BY s.id
     ORDER BY ${orderBy} DESC`,
    [],
    'Crush sessions',
  );

  const sessions: UnifiedSession[] = [];

  for (const rawRow of rows) {
    const row = parseSessionRow(rawRow);
    if (!row || row.messageCount <= 0) continue;

    const createdAt =
      normalizeTimestamp(row.firstMessageAt) ??
      normalizeTimestamp(row.sessionCreatedAt) ??
      normalizeTimestamp(row.sessionUpdatedAt) ??
      new Date(0);
    const updatedAt =
      normalizeTimestamp(row.lastMessageAt) ??
      normalizeTimestamp(row.sessionUpdatedAt) ??
      normalizeTimestamp(row.sessionCreatedAt) ??
      createdAt;
    const cwd = candidate.cwd;

    if (options?.cwd && cwd && !matchesCrushCwd(cwd, options.cwd)) continue;

    sessions.push({
      id: row.id,
      source: CRUSH_SOURCE,
      cwd,
      ...(cwd ? { repo: extractRepoFromCwd(cwd) } : {}),
      createdAt,
      updatedAt,
      originalPath: candidate.dbPath,
      ...(row.latestModel ? { model: row.latestModel } : {}),
    });
  }

  return sessions;
}

function sessionDbCandidate(session: UnifiedSession): CrushDbCandidate | undefined {
  if (!session.originalPath || path.basename(session.originalPath) !== CRUSH_DB_FILE) return undefined;
  return {
    dbPath: session.originalPath,
    cwd: session.cwd || inferCwdFromDbPath(session.originalPath),
  };
}

async function findDbForSession(session: UnifiedSession): Promise<CrushDbCandidate | undefined> {
  const direct = sessionDbCandidate(session);
  if (direct && (await pathExists(direct.dbPath))) return direct;

  const candidates = await getCrushDbCandidates(session.cwd ? { cwd: session.cwd } : undefined);
  for (const candidate of candidates) {
    if (!(await pathExists(candidate.dbPath))) continue;
    const db = await openReadOnlyDatabase(candidate.dbPath);
    if (!db) continue;
    try {
      const schema = getSchema(db);
      if (!schema) continue;
      const row = safeGet(db, 'SELECT id FROM sessions WHERE id = ? LIMIT 1', [session.id], 'Crush session lookup');
      if (isRecord(row) && stringValue(row, 'id') === session.id) return candidate;
    } finally {
      closeDatabase(db, candidate.dbPath);
    }
  }

  return undefined;
}

function listMessageRows(db: SqliteDatabase, schema: CrushSchema, sessionId: string): CrushMessageRow[] {
  const idSelect = selectColumn(schema.messageColumns, 'id', 'CAST(rowid AS TEXT)', 'id');
  const roleSelect = selectColumn(schema.messageColumns, 'role', "''", 'role');
  const partsSelect = selectColumn(schema.messageColumns, 'parts', "'[]'", 'parts');
  const modelSelect = selectColumn(schema.messageColumns, 'model', 'NULL', 'model');
  const createdAtSelect = selectColumn(schema.messageColumns, 'created_at', 'NULL', 'createdAt');
  const providerSelect = selectColumn(schema.messageColumns, 'provider', 'NULL', 'provider');
  const summarySelect = selectColumn(schema.messageColumns, 'is_summary_message', '0', 'isSummaryMessage');
  const rows = safeAll(
    db,
    `SELECT
       ${idSelect},
       ${roleSelect},
       ${partsSelect},
       ${createdAtSelect},
       ${modelSelect},
       ${providerSelect},
       ${summarySelect}
     FROM messages
     WHERE session_id = ?
     ORDER BY ${messageOrderBy(schema)}`,
    [sessionId],
    'Crush messages',
  );

  return rows.map(parseMessageRow).filter((row): row is CrushMessageRow => Boolean(row));
}

function buildParsedMessages(rows: CrushMessageRow[]): ParsedCrushMessage[] {
  const messages: ParsedCrushMessage[] = [];

  for (const row of rows) {
    if (row.isSummaryMessage) continue;

    const parts = parseParts(row.parts);
    if (parts.malformed) continue;

    const role = normalizeRole(row.role);
    if (!role) continue;

    const parsed: ParsedCrushMessage = { row, role, parts };
    messages.push(parsed);
  }

  return messages;
}

function buildConversation(parsedMessages: ParsedCrushMessage[]): {
  messages: MessageDraft[];
  model: string | undefined;
} {
  const messages: MessageDraft[] = [];
  let model: string | undefined;

  for (const parsed of parsedMessages) {
    const { row, role, parts } = parsed;
    if (!model && row.model) model = row.model;

    if (role === 'tool') continue;

    const content = parts.text.trim();
    if (!content) continue;

    messages.push({
      role,
      content,
      ...(normalizeTimestamp(row.createdAt) ? { timestamp: normalizeTimestamp(row.createdAt) } : {}),
      sourceId: row.id,
    });
  }

  return {
    messages,
    model,
  };
}

function emptyConversation(session: UnifiedSession): ParsedAgentConversation {
  return { session, messages: [] };
}

/**
 * Parse all Crush sessions from read-only SQLite databases.
 */
export async function parseCrushSessions(options?: SessionParseOptions): Promise<UnifiedSession[]> {
  const candidates = await getCrushDbCandidates(options);
  const sessions: UnifiedSession[] = [];

  for (const candidate of candidates) {
    const db = await openReadOnlyDatabase(candidate.dbPath);
    if (!db) continue;

    try {
      sessions.push(...listSessionsFromDb(db, candidate, options));
    } finally {
      closeDatabase(db, candidate.dbPath);
    }
  }

  sessions.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  return options?.limit ? sessions.slice(0, options.limit) : sessions;
}

/**
 * Extract visible messages from a Crush session.
 */
export async function extractCrushContext(session: UnifiedSession): Promise<ParsedAgentConversation> {
  const candidate = await findDbForSession(session);
  if (!candidate) {
    return emptyConversation(session);
  }

  const db = await openReadOnlyDatabase(candidate.dbPath);
  if (!db) {
    return emptyConversation(session);
  }

  try {
    const schema = getSchema(db);
    if (!schema) {
      return emptyConversation(session);
    }

    const rows = listMessageRows(db, schema, session.id);
    const parsed = buildParsedMessages(rows);
    const extracted = buildConversation(parsed);
    const enrichedSession: UnifiedSession = {
      ...session,
      cwd: session.cwd || candidate.cwd,
      ...(extracted.model || session.model ? { model: extracted.model ?? session.model } : {}),
    };

    return {
      session: enrichedSession,
      messages: sequenceMessages(extracted.messages),
    };
  } finally {
    closeDatabase(db, candidate.dbPath);
  }
}
