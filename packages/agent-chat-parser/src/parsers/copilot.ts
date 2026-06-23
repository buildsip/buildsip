import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentChatParserContext, ParsedAgentConversation, UnifiedSession } from '../types/index';
import type { CopilotEvent } from '../types/schemas';
import { CopilotWorkspaceSchema } from '../types/schemas';
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
async function findSessionDirs(ctx: AgentChatParserContext): Promise<string[]> {
  const sessionsDir = getCopilotSessionsDir();
  if (!fs.existsSync(sessionsDir)) return [];
  return listSubdirectories(ctx, sessionsDir).filter((dir) => fs.existsSync(path.join(dir, 'workspace.yaml')));
}

// Copilot workspace.yaml is a flat key:value file. Summary can be a multiline block, which we skip.
function parseWorkspaceYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = /^([a-z_][\w]*):\s*(.*)$/i.exec(trimmed);
    if (!match) continue;

    const key = match[1];
    if (!key) continue;

    const rawValue = match[2] ?? '';
    if (rawValue === '|' || rawValue === '>') {
      while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1]!)) {
        i++;
      }
      continue;
    }

    if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
      result[key] = rawValue.slice(1, -1);
      continue;
    }

    if (/^-?\d+$/.test(rawValue)) {
      result[key] = Number(rawValue);
      continue;
    }

    result[key] = rawValue;
  }

  return result;
}

function parseWorkspace(ctx: AgentChatParserContext, workspacePath: string) {
  try {
    const content = fs.readFileSync(workspacePath, 'utf8');
    const parsed = CopilotWorkspaceSchema.safeParse(parseWorkspaceYaml(content));
    if (!parsed.success) {
      ctx.log.debug('copilot: invalid workspace YAML', workspacePath, parsed.error);
      return null;
    }
    return parsed.data;
  } catch (err) {
    ctx.log.debug('copilot: failed to parse workspace YAML', workspacePath, err);
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
async function extractModel(ctx: AgentChatParserContext, eventsPath: string): Promise<string | undefined> {
  let selected: string | undefined;
  let latestCurrent: string | undefined;

  await scanJsonlFile(ctx,
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
export async function parseCopilotSessions(ctx: AgentChatParserContext): Promise<UnifiedSession[]> {
  const dirs = await findSessionDirs(ctx);
  const sessions: UnifiedSession[] = [];

  for (const sessionDir of dirs) {
    try {
      const workspacePath = path.join(sessionDir, 'workspace.yaml');
      const eventsPath = path.join(sessionDir, 'events.jsonl');

      const workspace = parseWorkspace(ctx, workspacePath);
      if (!workspace) continue;

      const eventsExist = fs.existsSync(eventsPath);
      if (!eventsExist) continue;
      const model = eventsExist ? await extractModel(ctx, eventsPath) : undefined;
      const eventStats = fs.statSync(eventsPath);
      const lastEventTimestamp = await extractLastEventTimestamp(ctx, eventsPath, eventStats.size);

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
      ctx.log.debug('copilot: skipping unparseable session', sessionDir, err);
      // Skip sessions we can't parse
    }
  }

  return sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/**
 * Extract visible messages from a Copilot session.
 */
export async function extractCopilotContext(
  ctx: AgentChatParserContext,
  session: UnifiedSession,
): Promise<ParsedAgentConversation> {
  const eventsPath = path.join(session.originalPath, 'events.jsonl');
  const events = await readJsonlFile<CopilotEvent>(ctx, eventsPath);

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

async function extractLastEventTimestamp(
  ctx: AgentChatParserContext,
  eventsPath: string,
  eventsFileSizeBytes?: number,
): Promise<Date | undefined> {
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
      ctx.log.debug('copilot: failed to stat events.jsonl for timestamp scan', eventsPath, err);
      return undefined;
    }
  }
  if (sizeBytes > MAX_TIMESTAMP_SCAN_BYTES) {
    return undefined;
  }

  let lastTimestamp: Date | undefined;
  await scanJsonlFile(ctx,
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
