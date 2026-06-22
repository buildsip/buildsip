import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { z } from 'zod';
import type { AgentChatParserContext, ParsedAgentConversation, UnifiedSession } from '../types/index';
import type {
  OpenCodeProject,
  OpenCodeSession,
  SqliteMessageRow,
  SqlitePartRow,
  SqliteProjectRow,
  SqliteSessionRow,
} from '../types/schemas';
import {
  OpenCodeMessageSchema,
  OpenCodePartSchema,
  OpenCodeProjectSchema,
  OpenCodeSessionSchema,
} from '../types/schemas';
import { findFiles, listSubdirectories } from '../utils/fs-helpers';
import { extractRepoFromCwd, homeDir, type MessageDraft, sequenceMessages } from '../utils/parser-helpers';

/** Minimal typed interface for node:sqlite DatabaseSync */
interface SqlitePreparedStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown | undefined;
}

interface SqliteDatabase {
  prepare(sql: string): SqlitePreparedStatement;
  close(): void;
}

/** Zod schema for message data blob stored in SQLite data column */
const SqliteMsgDataSchema = z
  .object({
    role: z.string(),
    modelID: z.string().optional(),
    providerID: z.string().optional(),
    cost: z.number().optional(),
  })
  .passthrough();

/** Zod schema for part data blob stored in SQLite data column */
const SqlitePartDataSchema = z.object({ type: z.string(), text: z.string().optional() }).passthrough();

function getOpenCodeBaseDir(): string {
  return process.env.XDG_DATA_HOME
    ? path.join(process.env.XDG_DATA_HOME, 'opencode')
    : path.join(homeDir(), '.local', 'share', 'opencode');
}

function getOpenCodeStorageDir(): string {
  return path.join(getOpenCodeBaseDir(), 'storage');
}

function getOpenCodeDbPaths(ctx: AgentChatParserContext): string[] {
  if (process.env.OPENCODE_DB) {
    return [process.env.OPENCODE_DB];
  }

  const baseDir = getOpenCodeBaseDir();
  const defaultDbPath = path.join(baseDir, 'opencode.db');
  const dbPaths: string[] = [];
  if (fs.existsSync(defaultDbPath)) {
    dbPaths.push(defaultDbPath);
  }

  try {
    const channelDbPaths = fs
      .readdirSync(baseDir)
      .filter((entry) => /^opencode-[^.]+\.db$/u.test(entry))
      .map((entry) => path.join(baseDir, entry))
      .sort((left, right) => {
        const rightStat = fs.statSync(right);
        const leftStat = fs.statSync(left);
        return rightStat.mtimeMs - leftStat.mtimeMs || left.localeCompare(right);
      });
    for (const channelDbPath of channelDbPaths) {
      if (!dbPaths.includes(channelDbPath)) {
        dbPaths.push(channelDbPath);
      }
    }
  } catch (err) {
    ctx.log.debug('opencode: failed to inspect channel SQLite DB variants', baseDir, err);
  }

  return dbPaths;
}

function renderHighValuePart(partData: Record<string, unknown>): { content?: string } {
  switch (partData.type) {
    case 'text':
      return { content: typeof partData.text === 'string' ? partData.text : undefined };
    default:
      return {};
  }
}

/**
 * Check if SQLite DB exists and is usable
 */
function hasSqliteDb(ctx: AgentChatParserContext): boolean {
  return getOpenCodeDbPaths(ctx).some((dbPath) => fs.existsSync(dbPath));
}

/**
 * Open SQLite database using node:sqlite (built-in)
 */
function openDb(ctx: AgentChatParserContext, dbPath: string): { db: SqliteDatabase; close: () => void } | null {
  try {
    // Dynamic import of node:sqlite to avoid issues on older Node versions
    const require = createRequire(import.meta.url);
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { open: true, readOnly: true }) as SqliteDatabase;
    return { db, close: () => db.close() };
  } catch (err) {
    ctx.log.debug('opencode: failed to open SQLite database', dbPath, err);
    return null;
  }
}

/**
 * Find all OpenCode session files
 */
async function findSessionFiles(ctx: AgentChatParserContext): Promise<string[]> {
  const sessionDir = path.join(getOpenCodeStorageDir(), 'session');
  const results: string[] = [];
  for (const projectDir of listSubdirectories(ctx, sessionDir)) {
    results.push(
      ...findFiles(ctx, projectDir, {
        match: (entry) => entry.name.startsWith('ses_') && entry.name.endsWith('.json'),
        recursive: false,
      }),
    );
  }
  return results;
}

/**
 * Parse a single OpenCode session file
 */
function parseSessionFile(ctx: AgentChatParserContext, filePath: string): OpenCodeSession | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const result = OpenCodeSessionSchema.safeParse(JSON.parse(content));
    if (result.success) return result.data;
    ctx.log.debug('opencode: session validation failed', filePath, result.error.message);
    return null;
  } catch (err) {
    ctx.log.debug('opencode: failed to parse session file', filePath, err);
    return null;
  }
}

/**
 * Load project info to get worktree/cwd
 */
function loadProjectInfo(ctx: AgentChatParserContext, projectId: string): OpenCodeProject | null {
  const projectFile = path.join(getOpenCodeStorageDir(), 'project', `${projectId}.json`);
  try {
    if (fs.existsSync(projectFile)) {
      const content = fs.readFileSync(projectFile, 'utf8');
      const result = OpenCodeProjectSchema.safeParse(JSON.parse(content));
      if (result.success) return result.data;
      ctx.log.debug('opencode: project validation failed', projectFile, result.error.message);
    }
  } catch (err) {
    ctx.log.debug('opencode: failed to parse project file', projectFile, err);
  }
  return null;
}

/**
 * Get first user message from session messages
 */
function getFirstUserMessage(ctx: AgentChatParserContext, sessionId: string): string {
  const messageDir = path.join(getOpenCodeStorageDir(), 'message', sessionId);
  if (!fs.existsSync(messageDir)) return '';

  try {
    const messageFiles = fs
      .readdirSync(messageDir)
      .filter((f) => f.startsWith('msg_') && f.endsWith('.json'))
      .sort(); // Sort to get chronological order

    for (const msgFile of messageFiles) {
      const msgPath = path.join(messageDir, msgFile);
      const msgContent = fs.readFileSync(msgPath, 'utf8');
      const msgResult = OpenCodeMessageSchema.safeParse(JSON.parse(msgContent));
      if (!msgResult.success) continue;
      const msg = msgResult.data;

      if (msg.role === 'user') {
        // Get the message text from parts
        const messageId = msg.id;
        const partDir = path.join(getOpenCodeStorageDir(), 'part', messageId);

        if (fs.existsSync(partDir)) {
          const partFiles = fs
            .readdirSync(partDir)
            .filter((f) => f.startsWith('prt_') && f.endsWith('.json'))
            .sort();

          for (const partFile of partFiles) {
            const partPath = path.join(partDir, partFile);
            const partContent = fs.readFileSync(partPath, 'utf8');
            const partResult = OpenCodePartSchema.safeParse(JSON.parse(partContent));
            if (!partResult.success) continue;
            const part = partResult.data;

            if (part.type === 'text' && part.text) {
              return part.text;
            }
          }
        }
      }
    }
  } catch (err) {
    ctx.log.debug('opencode: failed to read messages for session', sessionId, err);
  }

  return '';
}

/**
 * Parse all OpenCode sessions - SQLite first, then JSON fallback
 */
export async function parseOpenCodeSessions(ctx: AgentChatParserContext): Promise<UnifiedSession[]> {
  // Try SQLite database first (newer OpenCode versions)
  if (hasSqliteDb(ctx)) {
    const sessions = parseSessionsFromSqlite(ctx);
    if (sessions.length > 0) return sessions;
  }

  // Fallback to JSON files (older OpenCode versions)
  return parseSessionsFromJson(ctx);
}

/**
 * Parse sessions from SQLite database
 */
function parseSessionsFromSqlite(ctx: AgentChatParserContext): UnifiedSession[] {
  const sessionsById = new Map<string, UnifiedSession>();

  for (const dbPath of getOpenCodeDbPaths(ctx)) {
    const handle = openDb(ctx, dbPath);
    if (!handle) continue;

    const { db, close } = handle;
    try {
      const rows = db
        .prepare(
          'SELECT id, project_id, slug, directory, title, version, time_created, time_updated FROM session ORDER BY time_updated DESC',
        )
        .all() as SqliteSessionRow[];

      // Build project lookup
      const projectRows = db.prepare('SELECT id, worktree FROM project').all() as SqliteProjectRow[];
      const projectMap = new Map(projectRows.map((p: SqliteProjectRow) => [p.id, p.worktree]));

      for (const row of rows) {
        const cwd = row.directory || projectMap.get(row.project_id) || '';

        const nextSession: UnifiedSession = {
          id: row.id,
          source: 'opencode',
          cwd,
          repo: extractRepoFromCwd(cwd),
          createdAt: new Date(row.time_created),
          updatedAt: new Date(row.time_updated),
          originalPath: dbPath,
          model: undefined,
        };

        const existing = sessionsById.get(nextSession.id);
        if (!existing || existing.updatedAt.getTime() < nextSession.updatedAt.getTime()) {
          sessionsById.set(nextSession.id, nextSession);
        }
      }
    } catch (err) {
      ctx.log.debug('opencode: SQLite session query failed', dbPath, err);
    } finally {
      close();
    }
  }

  return Array.from(sessionsById.values()).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/**
 * Parse sessions from JSON files (legacy)
 */
async function parseSessionsFromJson(ctx: AgentChatParserContext): Promise<UnifiedSession[]> {
  const files = await findSessionFiles(ctx);
  const sessions: UnifiedSession[] = [];

  for (const filePath of files) {
    try {
      const session = parseSessionFile(ctx, filePath);
      if (!session || !session.id) continue;

      // Get project info for worktree
      const project = loadProjectInfo(ctx, session.projectID);
      const cwd = session.directory || project?.worktree || '';

      const firstUserMessage = getFirstUserMessage(ctx, session.id);
      if (!session.title && !firstUserMessage) continue;

      sessions.push({
        id: session.id,
        source: 'opencode',
        cwd,
        repo: extractRepoFromCwd(cwd),
        createdAt: new Date(session.time.created),
        updatedAt: new Date(session.time.updated),
        originalPath: filePath,
      });
    } catch (err) {
      ctx.log.debug('opencode: skipping unparseable JSON session', filePath, err);
      // Skip files we can't parse
    }
  }

  return sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/**
 * Read all messages from an OpenCode session - SQLite first, then JSON fallback
 */
function readAllMessages(ctx: AgentChatParserContext, sessionId: string): MessageDraft[] {
  // Try SQLite first
  if (hasSqliteDb(ctx)) {
    const msgs = readMessagesFromSqlite(ctx, sessionId);
    if (msgs.length > 0) return msgs;
  }

  // Fallback to JSON files
  return readMessagesFromJson(ctx, sessionId);
}

/**
 * Read messages from SQLite database
 */
function readMessagesFromSqlite(ctx: AgentChatParserContext, sessionId: string): MessageDraft[] {
  for (const dbPath of getOpenCodeDbPaths(ctx)) {
    const handle = openDb(ctx, dbPath);
    if (!handle) continue;

    const { db, close } = handle;
    try {
      const msgRows = db
        .prepare(
          'SELECT id, session_id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created ASC',
        )
        .all(sessionId) as SqliteMessageRow[];
      if (msgRows.length === 0) continue;

      const messages: MessageDraft[] = [];

      for (const msgRow of msgRows) {
        const msgDataResult = SqliteMsgDataSchema.safeParse(JSON.parse(msgRow.data));
        if (!msgDataResult.success) continue;
        const role: 'user' | 'assistant' = msgDataResult.data.role === 'user' ? 'user' : 'assistant';

        const partRows = db
          .prepare('SELECT data FROM part WHERE message_id = ? ORDER BY time_created ASC, id ASC')
          .all(msgRow.id) as SqlitePartRow[];

        const contentParts: string[] = [];
        for (const partRow of partRows) {
          let rawPartData: unknown;
          try {
            rawPartData = JSON.parse(partRow.data);
          } catch (err) {
            ctx.log.debug('opencode: failed to parse SQLite part JSON', msgRow.id, err);
            continue;
          }

          const partDataResult = SqlitePartDataSchema.safeParse(rawPartData);
          if (!partDataResult.success) continue;
          const rendered = renderHighValuePart(partDataResult.data);
          if (rendered.content) contentParts.push(rendered.content);
        }

        const content = contentParts.join('\n').trim();
        if (content) {
          messages.push({
            role,
            content,
            timestamp: new Date(msgRow.time_created),
          });
        }
      }

      return messages;
    } catch (err) {
      ctx.log.debug('opencode: SQLite message query failed for session', dbPath, sessionId, err);
    } finally {
      close();
    }
  }

  return [];
}

/**
 * Read messages from JSON files (legacy)
 */
function readMessagesFromJson(ctx: AgentChatParserContext, sessionId: string): MessageDraft[] {
  const messages: MessageDraft[] = [];
  const messageDir = path.join(getOpenCodeStorageDir(), 'message', sessionId);

  if (!fs.existsSync(messageDir)) return messages;

  try {
    const messageFiles = fs
      .readdirSync(messageDir)
      .filter((f) => f.startsWith('msg_') && f.endsWith('.json'))
      .sort();

    for (const msgFile of messageFiles) {
      const msgPath = path.join(messageDir, msgFile);
      const msgContent = fs.readFileSync(msgPath, 'utf8');
      const msgResult = OpenCodeMessageSchema.safeParse(JSON.parse(msgContent));
      if (!msgResult.success) continue;
      const msg = msgResult.data;

      // Get message text from parts
      const partDir = path.join(getOpenCodeStorageDir(), 'part', msg.id);
      const contentParts: string[] = [];

      if (fs.existsSync(partDir)) {
        const partFiles = fs
          .readdirSync(partDir)
          .filter((f) => f.startsWith('prt_') && f.endsWith('.json'))
          .sort();

        for (const partFile of partFiles) {
          const partPath = path.join(partDir, partFile);
          const partContent = fs.readFileSync(partPath, 'utf8');
          const partResult = OpenCodePartSchema.safeParse(JSON.parse(partContent));
          if (!partResult.success) continue;
          const rendered = renderHighValuePart(partResult.data);
          if (rendered.content) contentParts.push(rendered.content);
        }
      }

      const content = contentParts.join('\n').trim();
      if (content) {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content,
          timestamp: new Date(msg.time.created),
        });
      }
    }
  } catch (err) {
    ctx.log.debug('opencode: failed to read JSON messages for session', sessionId, err);
    // Ignore errors
  }

  return messages;
}

/**
 * Extract visible messages from an OpenCode session.
 */
export async function extractOpenCodeContext(
  ctx: AgentChatParserContext,
  session: UnifiedSession,
): Promise<ParsedAgentConversation> {
  return {
    session,
    messages: sequenceMessages(readAllMessages(ctx, session.id)),
  };
}
