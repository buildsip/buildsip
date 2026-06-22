import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../logger';
import type { ParsedAgentConversation, SessionParseOptions, UnifiedSession } from '../types/index';
import type { DroidEvent, DroidSessionStart, DroidSettings } from '../types/schemas';
import { DroidSettingsSchema } from '../types/schemas';
import { isSystemContent } from '../utils/content';
import { findFiles } from '../utils/fs-helpers';
import { readJsonlFile, scanJsonlFile } from '../utils/jsonl';
import { extractRepoFromCwd, homeDir, type MessageDraft, sequenceMessages } from '../utils/parser-helpers';
import { cwdFromSlug } from '../utils/slug';

const DROID_PROJECTS_DIR = path.join(homeDir(), '.factory', 'projects');
const DROID_SESSIONS_DIR = path.join(homeDir(), '.factory', 'sessions');
const DROID_SESSION_DIRS = [DROID_PROJECTS_DIR, DROID_SESSIONS_DIR];

/**
 * Find all Droid session JSONL files.
 * Structures:
 * - ~/.factory/projects/<workspace-slug>/<uuid>.jsonl
 * - ~/.factory/sessions/<workspace-slug>/<uuid>.jsonl
 */
async function findSessionFiles(): Promise<string[]> {
  const files = new Set<string>();
  for (const root of DROID_SESSION_DIRS) {
    for (const filePath of findFiles(root, {
      match: (entry) =>
        entry.name.endsWith('.jsonl') &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i.test(entry.name),
      maxDepth: 3,
    })) {
      files.add(filePath);
    }
  }
  return Array.from(files);
}

/**
 * Read companion .settings.json for a session
 */
function readSettings(jsonlPath: string): DroidSettings | null {
  const settingsPath = jsonlPath.replace(/\.jsonl$/, '.settings.json');
  try {
    if (fs.existsSync(settingsPath)) {
      const result = DroidSettingsSchema.safeParse(JSON.parse(fs.readFileSync(settingsPath, 'utf8')));
      if (result.success) return result.data;
      logger.debug('droid: settings validation failed', settingsPath, result.error.message);
      return null;
    }
  } catch (err) {
    logger.debug('droid: failed to read settings', settingsPath, err);
  }
  return null;
}

/**
 * Parse session metadata from session_start event and first user message
 */
async function parseSessionInfo(filePath: string): Promise<{
  sessionStart: DroidSessionStart | null;
  firstUserMessage: string;
  firstTimestamp: string;
  lastTimestamp: string;
  cwdIsNotGitRepo: boolean;
}> {
  let sessionStart: DroidSessionStart | null = null;
  let firstUserMessage = '';
  let firstTimestamp = '';
  let lastTimestamp = '';
  let cwdIsNotGitRepo = false;

  const visitor = (parsed: unknown): 'continue' | 'stop' => {
    const event = parsed as DroidEvent;

    if (event.type === 'session_start' && !sessionStart) {
      sessionStart = event;
    }

    if ('timestamp' in event && typeof event.timestamp === 'string') {
      if (!firstTimestamp) firstTimestamp = event.timestamp;
      lastTimestamp = event.timestamp;
    }

    if (event.type === 'message') {
      if (!firstUserMessage && event.message.role === 'user') {
        for (const block of event.message.content) {
          if (block.type === 'text' && block.text) {
            const cleaned = stripDroidInjectedText(block.text);
            if (block.text.includes('<system-reminder>') && block.text.includes('fatal: not a git repository')) {
              cwdIsNotGitRepo = true;
            }
            if (
              cleaned &&
              !cleaned.startsWith('<') &&
              !cleaned.startsWith('/') &&
              !cleaned.includes('Session Handoff')
            ) {
              firstUserMessage = cleaned;
              break;
            }
          }
        }
      }
    }

    return 'continue';
  };

  await scanJsonlFile(filePath, visitor);

  return { sessionStart, firstUserMessage, firstTimestamp, lastTimestamp, cwdIsNotGitRepo };
}

/**
 * Parse all Droid sessions
 */
export async function parseDroidSessions(_options: SessionParseOptions = {}): Promise<UnifiedSession[]> {
  const files = await findSessionFiles();
  const sessionsById = new Map<string, UnifiedSession>();

  for (const filePath of files) {
    try {
      const { sessionStart, firstUserMessage, firstTimestamp, lastTimestamp, cwdIsNotGitRepo } =
        await parseSessionInfo(filePath);
      if (!sessionStart) continue;

      const fileStats = fs.statSync(filePath);
      const settings = readSettings(filePath);

      const workspaceSlug = path.basename(path.dirname(filePath));
      const cwd = sessionStart.cwd || cwdFromSlug(workspaceSlug);

      if (!firstUserMessage && !sessionStart.sessionTitle) continue;

      const createdAt = firstTimestamp ? new Date(firstTimestamp) : fileStats.birthtime;
      const updatedAt = lastTimestamp ? new Date(lastTimestamp) : fileStats.mtime;

      const nextSession: UnifiedSession = {
        id: sessionStart.id,
        source: 'droid',
        cwd,
        repo: cwdIsNotGitRepo ? undefined : extractRepoFromCwd(cwd),
        createdAt,
        updatedAt,
        originalPath: filePath,
        model: settings?.model,
      };

      const existing = sessionsById.get(nextSession.id);
      const existingTime = existing?.updatedAt.getTime() ?? 0;
      const nextTime = nextSession.updatedAt.getTime();
      const nextIsProjectTranscript = nextSession.originalPath.startsWith(DROID_PROJECTS_DIR);
      if (!existing || existingTime < nextTime || (existingTime === nextTime && nextIsProjectTranscript)) {
        sessionsById.set(nextSession.id, nextSession);
      }
    } catch (err) {
      logger.debug('droid: skipping unparseable session', filePath, err);
      // Skip files we can't parse
    }
  }

  return Array.from(sessionsById.values()).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/**
 * Extract visible messages from a Droid session.
 */
export async function extractDroidContext(session: UnifiedSession): Promise<ParsedAgentConversation> {
  const events = await readJsonlFile<DroidEvent>(session.originalPath);
  const settings = readSettings(session.originalPath);

  const messages: MessageDraft[] = [];

  for (const event of events) {
    if (event.type !== 'message') continue;

    const textParts: string[] = [];
    for (const block of event.message.content) {
      if (block.type === 'text' && block.text) {
        const cleaned = stripDroidInjectedText(block.text);
        if (cleaned && !isSystemContent(cleaned)) {
          textParts.push(cleaned);
        }
      }
    }

    const text = textParts.join('\n').trim();
    if (!text) continue;

    messages.push({
      role: event.message.role === 'user' ? 'user' : 'assistant',
      content: text,
      timestamp: event.timestamp ? new Date(event.timestamp) : undefined,
      sourceId: event.id,
      sourceParentId: event.parentId,
    });
  }

  return {
    session: settings?.model ? { ...session, model: settings.model } : session,
    messages: sequenceMessages(messages),
  };
}

function stripDroidInjectedText(text: string): string {
  const hadSystemReminder = text.includes('<system-reminder>');
  let result = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/giu, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/giu, '')
    .replace(/<command-name>[\s\S]*?<\/command-name>/giu, '');
  if (hadSystemReminder) {
    // Strip TodoWrite tool-list dump only when it appears as a contiguous run of
    // CapitalizedToolName lines starting at a line boundary. Earlier `[\s\S]*$`
    // version was too greedy: `\nTodoWrite\nListTodos\n<user prose>` deleted the
    // user prose along with the tool list. The bounded form stops at the first
    // non-capitalized line, preserving any trailing user content.
    result = result.replace(/^[ \t]*TodoWrite\b(?:\r?\n[ \t]*[A-Z][A-Za-z0-9]+\b)*[ \t]*\r?$/m, '');
  }
  return result.trim();
}
