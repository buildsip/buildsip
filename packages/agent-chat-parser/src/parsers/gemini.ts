import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { logger } from '../logger';
import type { ParsedAgentConversation, UnifiedSession } from '../types/index';
import type { GeminiMessage, GeminiSession } from '../types/schemas';
import { GeminiMessageSchema, GeminiSessionSchema } from '../types/schemas';
import { extractTextFromBlocks } from '../utils/content';
import { findFiles, listSubdirectories } from '../utils/fs-helpers';
import { homeDir, type MessageDraft, sequenceMessages } from '../utils/parser-helpers';

const geminiHome = process.env.GEMINI_CLI_HOME || homeDir();
const GEMINI_BASE_DIR = path.join(geminiHome, '.gemini', 'tmp');
const GEMINI_LEGACY_DIR = path.join(geminiHome, '.gemini', 'sessions');
const GEMINI_PROJECTS_PATH = path.join(geminiHome, '.gemini', 'projects.json');

type GeminiSessionData = GeminiSession & {
  directories?: string[];
  summary?: string;
};

type GeminiJsonlRecord = Partial<GeminiSessionData> & {
  $rewindTo?: string;
  $set?: Partial<GeminiSessionData>;
};

/**
 * Find all Gemini session files (new and legacy storage formats)
 */
async function findSessionFiles(): Promise<string[]> {
  const results: string[] = [];

  // Current format: ~/.gemini/tmp/<project-hash>/chats/*.jsonl
  // Legacy chats path: ~/.gemini/tmp/<project-hash>/chats/session-*.json
  if (fs.existsSync(GEMINI_BASE_DIR)) {
    for (const projectDir of listSubdirectories(GEMINI_BASE_DIR)) {
      if (path.basename(projectDir) === 'bin') continue;
      const chatsDir = path.join(projectDir, 'chats');
      results.push(
        ...findFiles(chatsDir, {
          match: (entry) =>
            entry.name.endsWith('.jsonl') || (entry.name.startsWith('session-') && entry.name.endsWith('.json')),
          recursive: false,
        }),
      );
    }
  }

  // Legacy format: ~/.gemini/sessions/*.json
  if (fs.existsSync(GEMINI_LEGACY_DIR)) {
    results.push(
      ...findFiles(GEMINI_LEGACY_DIR, {
        match: (entry) => entry.name.endsWith('.json'),
        recursive: false,
      }),
    );
  }

  return results;
}

async function loadProjectDirectoryMap(): Promise<Map<string, string>> {
  try {
    const content = await fs.promises.readFile(GEMINI_PROJECTS_PATH, 'utf8');
    const parsed = JSON.parse(content) as { projects?: Record<string, string> };
    const entries = Object.entries(parsed.projects ?? {});
    return new Map(entries.map(([cwd, projectId]) => [projectId, cwd]));
  } catch (err) {
    logger.debug('gemini: failed to load projects.json mapping', GEMINI_PROJECTS_PATH, err);
    return new Map();
  }
}

function toGeminiMessage(record: GeminiJsonlRecord): GeminiMessage | null {
  const result = GeminiMessageSchema.safeParse(record);
  if (result.success) return result.data;
  logger.debug('gemini: message validation failed', result.error.message);
  return null;
}

function getSessionDirectory(session: GeminiSessionData, projectDirectories: Map<string, string>): string {
  const metadataDirectory = session.directories?.find(
    (directory) => typeof directory === 'string' && directory.length > 0,
  );
  return metadataDirectory || projectDirectories.get(session.projectHash) || '';
}

function findRewindIndex(messages: GeminiMessage[], messageId: string): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.id === messageId) {
      return index;
    }
  }
  return -1;
}

async function parseJsonlSessionFile(filePath: string): Promise<GeminiSessionData | null> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  const sessionState: Partial<GeminiSessionData> = {};
  const messages: GeminiMessage[] = [];
  const messageIndexById = new Map<string, number>();

  try {
    for await (const rawLine of rl) {
      const line = rawLine.trim();
      if (!line) continue;

      let record: GeminiJsonlRecord;
      try {
        record = JSON.parse(line) as GeminiJsonlRecord;
      } catch (err) {
        logger.debug('gemini: skipping malformed JSONL record', filePath, err);
        continue;
      }

      if (record.$set && typeof record.$set === 'object') {
        Object.assign(sessionState, record.$set);
        continue;
      }

      if (typeof record.$rewindTo === 'string') {
        const rewindIndex = findRewindIndex(messages, record.$rewindTo);
        if (rewindIndex >= 0) {
          messages.length = rewindIndex;
          for (const [messageId, index] of messageIndexById.entries()) {
            if (index >= rewindIndex) {
              messageIndexById.delete(messageId);
            }
          }
        }
        continue;
      }

      const message = toGeminiMessage(record);
      if (message) {
        if (message.id) {
          const existingIndex = messageIndexById.get(message.id);
          if (existingIndex !== undefined) {
            messages[existingIndex] = message;
          } else {
            messageIndexById.set(message.id, messages.length);
            messages.push(message);
          }
        } else {
          messages.push(message);
        }
        continue;
      }

      Object.assign(sessionState, record);
    }
  } finally {
    rl.close();
    stream.close();
  }

  const parsed = GeminiSessionSchema.safeParse({
    sessionId: sessionState.sessionId,
    projectHash: sessionState.projectHash,
    startTime: sessionState.startTime,
    lastUpdated: sessionState.lastUpdated,
    messages,
  });

  if (!parsed.success) {
    logger.debug('gemini: JSONL session validation failed', filePath, parsed.error.message);
    return null;
  }

  return {
    ...parsed.data,
    ...(typeof sessionState.summary === 'string' ? { summary: sessionState.summary } : {}),
    ...(Array.isArray(sessionState.directories)
      ? {
          directories: sessionState.directories.filter(
            (directory): directory is string => typeof directory === 'string' && directory.length > 0,
          ),
        }
      : {}),
  };
}

/**
 * Parse a single Gemini session file
 */
async function parseSessionFile(filePath: string): Promise<GeminiSessionData | null> {
  try {
    if (filePath.endsWith('.jsonl')) {
      return await parseJsonlSessionFile(filePath);
    }

    const content = await fs.promises.readFile(filePath, 'utf8');
    const result = GeminiSessionSchema.safeParse(JSON.parse(content));
    if (result.success) return result.data;
    logger.debug('gemini: session validation failed', filePath, result.error.message);
    return null;
  } catch (err) {
    logger.debug('gemini: failed to parse session file', filePath, err);
    return null;
  }
}

/**
 * Extract text content from Gemini message (handles both string and array formats)
 */
function extractGeminiContent(content: string | Array<{ text?: string; type?: string }>): string {
  return extractTextFromBlocks(content as string | Array<{ type: string; text?: string }>);
}

/**
 * Extract first real user message from Gemini session
 */
function extractFirstUserMessage(session: GeminiSession): string {
  for (const msg of session.messages) {
    if (msg.type === 'user' && msg.content) {
      return extractGeminiContent(msg.content);
    }
  }
  return '';
}

/**
 * Parse all Gemini sessions
 */
export async function parseGeminiSessions(): Promise<UnifiedSession[]> {
  const files = await findSessionFiles();
  const projectDirectories = await loadProjectDirectoryMap();
  const sessions: UnifiedSession[] = [];

  for (const filePath of files) {
    try {
      const session = await parseSessionFile(filePath);
      if (!session || !session.sessionId) continue;

      const firstUserMessage = extractFirstUserMessage(session);
      if (!session.summary && !firstUserMessage) continue;

      const cwd = getSessionDirectory(session, projectDirectories);

      sessions.push({
        id: session.sessionId,
        source: 'gemini',
        cwd,
        repo: '',
        createdAt: new Date(session.startTime),
        updatedAt: new Date(session.lastUpdated),
        originalPath: filePath,
      });
    } catch (err) {
      logger.debug('gemini: skipping unparseable session', filePath, err);
      // Skip files we can't parse
    }
  }

  // Filter sessions that have real user messages (not just auth flows)
  return sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/**
 * Extract visible messages from a Gemini session.
 */
export async function extractGeminiContext(session: UnifiedSession): Promise<ParsedAgentConversation> {
  const sessionData = await parseSessionFile(session.originalPath);
  const messages: MessageDraft[] = [];
  let model = session.model;

  if (sessionData) {
    for (const msg of sessionData.messages) {
      if (msg.model && !model) model = msg.model;

      if (msg.type === 'user') {
        const content = extractGeminiContent(msg.content);
        if (!content) continue;
        messages.push({
          role: 'user',
          content,
          timestamp: new Date(msg.timestamp),
          sourceId: msg.id,
        });
      } else if (msg.type === 'gemini') {
        const textContent = extractGeminiContent(msg.content);
        if (textContent) {
          messages.push({
            role: 'assistant',
            content: textContent,
            timestamp: new Date(msg.timestamp),
            sourceId: msg.id,
          });
        }
      }
    }
  }

  return {
    session: model ? { ...session, model } : session,
    messages: sequenceMessages(messages),
  };
}
