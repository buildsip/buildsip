import * as fs from 'node:fs';
import * as path from 'node:path';
import YAML from 'yaml';
import { logger } from '../logger';
import type { ParsedAgentConversation, UnifiedSession } from '../types/index';
import type { CopilotEvent, CopilotWorkspace } from '../types/schemas';
import { listSubdirectories } from '../utils/fs-helpers';
import { readJsonlFile, scanJsonlFile } from '../utils/jsonl';
import { homeDir, type MessageDraft, sequenceMessages } from '../utils/parser-helpers';

function getCopilotRoot(): string {
  const configuredHome = process.env.COPILOT_HOME?.trim();
  return configuredHome || path.join(homeDir(), '.copilot');
}

function getCopilotSessionsDir(): string {
  return path.join(getCopilotRoot(), 'session-state');
}

/**
 * Find all Copilot session directories
 */
async function findSessionDirs(): Promise<string[]> {
  const sessionsDir = getCopilotSessionsDir();
  if (!fs.existsSync(sessionsDir)) return [];
  return listSubdirectories(sessionsDir).filter((dir) => fs.existsSync(path.join(dir, 'workspace.yaml')));
}

/**
 * Parse workspace.yaml file
 */
function parseWorkspace(workspacePath: string): CopilotWorkspace | null {
  try {
    const content = fs.readFileSync(workspacePath, 'utf8');
    return YAML.parse(content) as CopilotWorkspace;
  } catch (err) {
    logger.debug('copilot: failed to parse workspace YAML', workspacePath, err);
    return null;
  }
}

/**
 * Extract model from events.jsonl.
 *
 * `selectedModel` is set on session.start (early in the file); `currentModel` is also
 * written on session.shutdown events at the END of the file. Real Copilot sessions where
 * the model field doesn't appear in the first 50 lines were missing it entirely. Scan up
 * to 1 MiB and prefer selectedModel (early return on first match), falling back to the
 * latest currentModel observed during the bounded scan.
 */
async function extractModel(eventsPath: string): Promise<string | undefined> {
  let selected: string | undefined;
  let latestCurrent: string | undefined;

  await scanJsonlFile(
    eventsPath,
    (parsed) => {
      const event = parsed as CopilotEvent;
      if (event.data?.selectedModel) {
        selected = event.data.selectedModel;
        return 'stop';
      }
      if (event.data?.currentModel) {
        latestCurrent = event.data.currentModel;
      }
      return 'continue';
    },
    { maxBytes: 1024 * 1024 },
  );

  return selected ?? latestCurrent;
}

/**
 * Parse all Copilot sessions
 */
export async function parseCopilotSessions(): Promise<UnifiedSession[]> {
  const dirs = await findSessionDirs();
  const sessions: UnifiedSession[] = [];

  for (const sessionDir of dirs) {
    try {
      const workspacePath = path.join(sessionDir, 'workspace.yaml');
      const eventsPath = path.join(sessionDir, 'events.jsonl');

      const workspace = parseWorkspace(workspacePath);
      if (!workspace) continue;

      const eventsExist = fs.existsSync(eventsPath);
      if (!eventsExist) continue;
      const model = eventsExist ? await extractModel(eventsPath) : undefined;
      const eventStats = fs.statSync(eventsPath);
      const lastEventTimestamp = await extractLastEventTimestamp(eventsPath, eventStats.size);

      sessions.push({
        id: workspace.id,
        source: 'copilot',
        cwd: workspace.cwd,
        repo: workspace.repository,
        branch: workspace.branch,
        createdAt: new Date(workspace.created_at),
        updatedAt: lastEventTimestamp ?? new Date(workspace.updated_at),
        originalPath: sessionDir,
        model,
      });
    } catch (err) {
      logger.debug('copilot: skipping unparseable session', sessionDir, err);
      // Skip sessions we can't parse
    }
  }

  return sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/**
 * Extract visible messages from a Copilot session.
 */
export async function extractCopilotContext(session: UnifiedSession): Promise<ParsedAgentConversation> {
  const eventsPath = path.join(session.originalPath, 'events.jsonl');
  const events = await readJsonlFile<CopilotEvent>(eventsPath);

  const messages: MessageDraft[] = [];

  for (const event of events) {
    if (event.type === 'user.message') {
      const content = event.data?.content || event.data?.transformedContent || '';
      if (content) {
        messages.push({
          role: 'user',
          content,
          timestamp: new Date(event.timestamp),
          sourceId: event.id,
          sourceParentId: event.parentId ?? undefined,
        });
      }
    } else if (event.type === 'assistant.message') {
      const content = event.data?.content || '';

      if (content) {
        messages.push({
          role: 'assistant',
          content: typeof content === 'string' ? content : JSON.stringify(content),
          timestamp: new Date(event.timestamp),
          sourceId: event.id,
          sourceParentId: event.parentId ?? undefined,
        });
      }
    }
  }

  return {
    session,
    messages: sequenceMessages(messages),
  };
}

// Cap the timestamp scan so discovery (called every list) stays fast on
// multi-MB events.jsonl files; falls back to workspace.updated_at on the rare
// session that exceeds the cap.
const MAX_TIMESTAMP_SCAN_BYTES = 1024 * 1024;

async function extractLastEventTimestamp(eventsPath: string, eventsFileSizeBytes?: number): Promise<Date | undefined> {
  // If the file exceeds the scan cap, scanJsonlFile would truncate mid-file and leave us
  // with some early timestamp instead of the actual last event. That would make active
  // large sessions appear oldest in lists. Skip the scan entirely so the caller's
  // `?? new Date(workspace.updated_at)` fallback fires. When the caller has already
  // stat'd the file (parseCopilotSessions), reuse that size to avoid a redundant statSync.
  let sizeBytes = eventsFileSizeBytes;
  if (sizeBytes === undefined) {
    try {
      sizeBytes = fs.statSync(eventsPath).size;
    } catch (err) {
      logger.debug('copilot: failed to stat events.jsonl for timestamp scan', eventsPath, err);
      return undefined;
    }
  }
  if (sizeBytes > MAX_TIMESTAMP_SCAN_BYTES) {
    return undefined;
  }

  let lastTimestamp: Date | undefined;
  await scanJsonlFile(
    eventsPath,
    (parsed) => {
      const event = parsed as CopilotEvent;
      const timestamp = event.timestamp ? new Date(event.timestamp) : undefined;
      if (timestamp && !Number.isNaN(timestamp.getTime())) {
        lastTimestamp = timestamp;
      }
      return 'continue';
    },
    { maxBytes: MAX_TIMESTAMP_SCAN_BYTES },
  );
  return lastTimestamp;
}
