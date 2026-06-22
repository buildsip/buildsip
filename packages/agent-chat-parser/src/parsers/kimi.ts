import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { logger } from '../logger';
import type { ParsedAgentConversation, UnifiedSession } from '../types/index';
import type { KimiMessage } from '../types/schemas';
import { extractTextFromBlocks } from '../utils/content';
import { extractRepoFromCwd, homeDir, type MessageDraft, sequenceMessages } from '../utils/parser-helpers';

function getKimiShareDir(): string {
  const configured = process.env.KIMI_SHARE_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(homeDir(), '.kimi');
}

const KIMI_SHARE_DIR = getKimiShareDir();
const KIMI_SESSIONS_DIR = path.join(KIMI_SHARE_DIR, 'sessions');
const KIMI_CONFIG_PATH = path.join(KIMI_SHARE_DIR, 'kimi.json');

type KimiWorkDirEntry = { path: string; kaos?: string };
type KimiSessionMetadata = {
  sessionId?: string;
  title?: string;
  archived?: boolean;
  wireMtime?: number | null;
};
type KimiMetadataFields = KimiSessionMetadata & {
  archivedPresent: boolean;
  wireMtimePresent: boolean;
};
type KimiContextReadResult = {
  contextPath: string;
  messages: KimiMessage[];
  mtime?: Date;
  birthtime?: Date;
};

type KimiContentBlock = Record<string, unknown> & { type: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | null | undefined {
  const value = record[key];
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function hashWorkDirPath(workDirPath: string): string {
  return createHash('md5').update(workDirPath, 'utf8').digest('hex');
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const parsed: unknown = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
    return isRecord(parsed) ? parsed : undefined;
  } catch (err) {
    logger.debug('kimi: failed to parse json file', filePath, err);
    return undefined;
  }
}

async function parseKimiWorkDirs(): Promise<KimiWorkDirEntry[]> {
  try {
    const raw = await readJsonObject(KIMI_CONFIG_PATH);
    if (!raw) return [];
    const workDirs = Array.isArray(raw.work_dirs) ? raw.work_dirs : [];

    return workDirs
      .map((item) => {
        if (typeof item === 'string') return { path: item };
        if (!item || typeof item !== 'object') return null;
        const candidate = item as { path?: unknown; kaos?: unknown };
        if (typeof candidate.path !== 'string' || candidate.path.length === 0) return null;
        return {
          path: candidate.path,
          kaos: typeof candidate.kaos === 'string' && candidate.kaos.length > 0 ? candidate.kaos : undefined,
        };
      })
      .filter((entry): entry is KimiWorkDirEntry => entry !== null);
  } catch (err) {
    logger.debug('kimi: failed to parse kimi.json work_dirs', err);
    return [];
  }
}

function buildWorkDirHashIndex(workDirs: KimiWorkDirEntry[]): Map<string, string> {
  const hashIndex = new Map<string, string>();

  for (const wd of workDirs) {
    const md5 = hashWorkDirPath(wd.path);
    const keys = [md5];

    // Kimi can prefix non-local KAOS sessions as "{kaos}_{md5}".
    if (wd.kaos && wd.kaos.toLowerCase() !== 'local') {
      keys.push(`${wd.kaos}_${md5}`);
    }

    for (const key of keys) {
      if (!hashIndex.has(key)) {
        hashIndex.set(key, wd.path);
      }
    }
  }

  return hashIndex;
}

function resolveCwdFromSessionDir(sessionDir: string, hashIndex: Map<string, string>): string {
  const workDirHash = path.basename(path.dirname(sessionDir));
  return hashIndex.get(workDirHash) || '';
}

function resolveContextPath(sessionPath: string): string {
  return sessionPath.endsWith('.jsonl') ? sessionPath : path.join(sessionPath, 'context.jsonl');
}

function deriveSessionId(sessionPath: string): string {
  if (sessionPath.endsWith('.jsonl')) {
    return path.basename(sessionPath, '.jsonl');
  }
  return path.basename(sessionPath);
}

async function getSessionMetadataDir(sessionPath: string): Promise<string | undefined> {
  try {
    const stats = await fs.promises.stat(sessionPath);
    return stats.isDirectory() ? sessionPath : undefined;
  } catch {
    return undefined;
  }
}

async function listSubdirectoriesAsync(dir: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const subdirs: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        subdirs.push(fullPath);
      } else if (entry.isSymbolicLink()) {
        try {
          const stat = await fs.promises.stat(fullPath);
          if (stat.isDirectory()) subdirs.push(fullPath);
        } catch {
          // broken symlink — skip
        }
      }
    }
    return subdirs;
  } catch (err) {
    logger.debug('kimi: cannot list subdirectories of', dir, err);
    return [];
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find all Kimi session directories and legacy flat context files.
 */
async function findSessionPaths(): Promise<string[]> {
  if (!(await pathExists(KIMI_SESSIONS_DIR))) {
    return [];
  }

  const results: string[] = [];

  // Kimi stores sessions as: ~/.kimi/sessions/{workdir_hash}/{session_id}/
  const workdirDirs = await listSubdirectoriesAsync(KIMI_SESSIONS_DIR);
  for (const workdirDir of workdirDirs) {
    try {
      const entries = await fs.promises.readdir(workdirDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(workdirDir, entry.name);
        if (entry.isDirectory() || entry.isSymbolicLink()) {
          // Directory or symlink (covers symlinked dirs and symlinked flat files).
          // For symlinks, follow once via stat to decide which branch applies.
          let isDir = entry.isDirectory();
          let isFile = false;
          if (entry.isSymbolicLink()) {
            try {
              const stat = await fs.promises.stat(fullPath);
              isDir = stat.isDirectory();
              isFile = stat.isFile();
            } catch {
              continue; // broken symlink — skip
            }
          }
          if (isDir) {
            const contextPath = path.join(fullPath, 'context.jsonl');
            if (await pathExists(contextPath)) {
              results.push(fullPath);
            }
          } else if (isFile && fullPath.endsWith('.jsonl')) {
            results.push(fullPath);
          }
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          results.push(fullPath);
        }
      }
    } catch (err) {
      logger.debug('kimi: cannot read workdir session directory', workdirDir, err);
    }
  }

  return results;
}

/**
 * Parse legacy metadata.json and current state.json from a Kimi session directory.
 */
function extractMetadataFields(raw: Record<string, unknown>): KimiMetadataFields {
  const title = stringField(raw, 'custom_title') || stringField(raw, 'title');
  const wireMtime = numberField(raw, 'wire_mtime');
  const archivedPresent = typeof raw.archived === 'boolean';

  return {
    sessionId: stringField(raw, 'session_id'),
    title: title && title !== 'Untitled' ? title : undefined,
    archived: archivedPresent ? raw.archived === true : undefined,
    ...(wireMtime !== undefined ? { wireMtime } : {}),
    archivedPresent,
    wireMtimePresent: wireMtime !== undefined,
  };
}

function emptyMetadataFields(): KimiMetadataFields {
  return {
    archivedPresent: false,
    wireMtimePresent: false,
  };
}

async function parseSessionMetadata(sessionDir: string): Promise<KimiSessionMetadata> {
  const [legacyRaw, stateRaw] = await Promise.all([
    readJsonObject(path.join(sessionDir, 'metadata.json')),
    readJsonObject(path.join(sessionDir, 'state.json')),
  ]);

  const legacy = legacyRaw ? extractMetadataFields(legacyRaw) : emptyMetadataFields();
  const state = stateRaw ? extractMetadataFields(stateRaw) : emptyMetadataFields();

  return {
    sessionId: state.sessionId || legacy.sessionId,
    title: state.title || legacy.title,
    archived: state.archivedPresent ? state.archived : legacy.archived,
    wireMtime: state.wireMtimePresent ? state.wireMtime : legacy.wireMtime,
  };
}

async function getMetadataCreatedAt(sessionDir: string, fallback: Date): Promise<Date> {
  for (const filename of ['state.json', 'metadata.json']) {
    try {
      const stats = await fs.promises.stat(path.join(sessionDir, filename));
      return stats.birthtime;
    } catch (err) {
      logger.debug('kimi: metadata stats unavailable', sessionDir, filename, err);
    }
  }

  return fallback;
}

/**
 * Read context.jsonl from a Kimi session directory.
 *
 * Single-pass implementation: streams the file once and parses visible message
 * records while using a single async stat to obtain mtime/birthtime.
 */
async function readContextData(sessionPath: string): Promise<KimiContextReadResult> {
  const contextPath = resolveContextPath(sessionPath);
  const empty: KimiContextReadResult = {
    contextPath,
    messages: [],
  };

  let stats: fs.Stats;
  try {
    stats = await fs.promises.stat(contextPath);
  } catch (err) {
    logger.debug('kimi: failed to stat context', contextPath, err);
    return empty;
  }

  if (stats.size === 0) {
    return { ...empty, mtime: stats.mtime, birthtime: stats.birthtime };
  }

  const messages: KimiMessage[] = [];

  const decoder = new StringDecoder('utf8');
  const stream = fs.createReadStream(contextPath);
  let lineBuffer = '';

  const finishLine = (line: string): void => {
    if (line.length === 0) {
      return;
    }
    const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      logger.debug('kimi: skipping invalid JSON line in', contextPath);
      return;
    }
    if (!isRecord(parsed)) {
      logger.debug('kimi: skipping non-object context record', contextPath);
      return;
    }
    if (typeof parsed.role !== 'string') {
      logger.debug('kimi: skipping context record with missing role', contextPath);
      return;
    }
    messages.push(parsed as KimiMessage);
  };

  try {
    for await (const chunk of stream) {
      const text = decoder.write(chunk as Buffer);
      let start = 0;
      let newlineIndex = text.indexOf('\n', start);
      while (newlineIndex !== -1) {
        lineBuffer += text.slice(start, newlineIndex);
        finishLine(lineBuffer);
        lineBuffer = '';
        start = newlineIndex + 1;
        newlineIndex = text.indexOf('\n', start);
      }
      lineBuffer += text.slice(start);
    }
    const remaining = decoder.end();
    if (remaining.length > 0) lineBuffer += remaining;
    if (lineBuffer.length > 0) {
      finishLine(lineBuffer);
    }
  } catch (err) {
    logger.debug('kimi: failed to read context', sessionPath, err);
    return empty;
  }

  return {
    contextPath,
    messages,
    mtime: stats.mtime,
    birthtime: stats.birthtime,
  };
}

function getContentBlocks(content: unknown): KimiContentBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter((block): block is KimiContentBlock => isRecord(block) && typeof block.type === 'string');
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string' || content === undefined) {
    return extractTextFromBlocks(content);
  }

  const blocks = getContentBlocks(content).map((block) => ({
    type: block.type,
    text: typeof block.text === 'string' ? block.text : undefined,
  }));
  return extractTextFromBlocks(blocks);
}

/**
 * Extract first real user message from Kimi messages
 */
function extractFirstUserMessage(messages: KimiMessage[]): string {
  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = extractMessageText(msg.content);
      if (text) return text;
    }
  }
  return '';
}

/**
 * Parse all Kimi sessions
 */
export async function parseKimiSessions(): Promise<UnifiedSession[]> {
  const sessionPaths = await findSessionPaths();
  const sessions: UnifiedSession[] = [];
  const workDirHashIndex = buildWorkDirHashIndex(await parseKimiWorkDirs());

  for (const sessionPath of sessionPaths) {
    try {
      const metadataDir = await getSessionMetadataDir(sessionPath);
      const metadata = metadataDir ? await parseSessionMetadata(metadataDir) : {};
      if (metadata.archived === true) continue;
      const sessionId = metadata.sessionId || deriveSessionId(sessionPath);
      if (!sessionId) continue;

      const contextData = await readContextData(sessionPath);
      if (contextData.messages.length === 0) continue;
      // readContextData supplies mtime/birthtime from a single async stat, so we
      // don't need a separate fs.statSync(contextPath) here.
      if (!contextData.mtime || !contextData.birthtime) continue;

      const firstUserMessage = extractFirstUserMessage(contextData.messages);
      if (!firstUserMessage && !metadata.title) continue;

      const cwd = resolveCwdFromSessionDir(sessionPath, workDirHashIndex);
      const repo = extractRepoFromCwd(cwd);

      let updatedAt = contextData.mtime;
      if (metadata.wireMtime !== null && metadata.wireMtime !== undefined && metadata.wireMtime > 0) {
        const wireUpdatedAt = new Date(metadata.wireMtime * 1000);
        if (!Number.isNaN(wireUpdatedAt.getTime())) {
          updatedAt = wireUpdatedAt;
        }
      }

      sessions.push({
        id: sessionId,
        source: 'kimi',
        cwd,
        repo,
        createdAt: metadataDir ? await getMetadataCreatedAt(metadataDir, contextData.birthtime) : contextData.birthtime,
        updatedAt,
        originalPath: sessionPath,
      });
    } catch (err) {
      logger.debug('kimi: skipping unparseable session', sessionPath, err);
      // Skip sessions we can't parse
    }
  }

  return sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/**
 * Extract visible messages from a Kimi session.
 */
export async function extractKimiContext(session: UnifiedSession): Promise<ParsedAgentConversation> {
  const contextData = await readContextData(session.originalPath);
  const parsedMessages: MessageDraft[] = [];

  for (const msg of contextData.messages) {
    if (msg.role === 'user') {
      const content = extractMessageText(msg.content);
      if (content) {
        parsedMessages.push({
          role: 'user',
          content,
        });
      }
    } else if (msg.role === 'assistant') {
      const content = extractMessageText(msg.content);
      if (content) {
        parsedMessages.push({
          role: 'assistant',
          content,
        });
      }
    }
  }

  return {
    session,
    messages: sequenceMessages(parsedMessages),
  };
}
