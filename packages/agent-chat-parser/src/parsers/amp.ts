import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentChatParserContext, ParsedAgentConversation, UnifiedSession } from '../types/index';
import { extractTextFromBlocks } from '../utils/content';
import { findFiles } from '../utils/fs-helpers';
import { extractRepo, homeDir, type MessageDraft, sequenceMessages } from '../utils/parser-helpers';

// ── Amp Thread JSON shape ───────────────────────────────────────────────────
// Minimal interfaces matching ~/.local/share/amp/threads/{id}.json

interface AmpContentBlock {
  type: string;
  text?: string;
  provider?: string;
}

interface AmpMessage {
  role: 'user' | 'assistant';
  messageId: number;
  content: AmpContentBlock[];
  meta?: {
    sentAt?: number;
  };
}

interface AmpThread {
  id: string;
  title?: string;
  created: number; // milliseconds since epoch
  messages: AmpMessage[];
  env?: {
    initial?: {
      tags?: string[];
      trees?: Array<{
        uri?: string;
        repository?: {
          url?: string;
          ref?: string;
          sha?: string;
        };
      }>;
    };
  };
}

const AMP_BASE_DIR = process.env.XDG_DATA_HOME
  ? path.join(process.env.XDG_DATA_HOME, 'amp', 'threads')
  : path.join(homeDir(), '.local', 'share', 'amp', 'threads');

function safeFileURLToPath(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    return '';
  }
}

/**
 * Find all Amp thread JSON files
 */
function findSessionFiles(ctx: AgentChatParserContext): string[] {
  return findFiles(ctx, AMP_BASE_DIR, {
    match: (entry) => entry.name.endsWith('.json'),
    recursive: false,
  });
}

/**
 * Read and parse a thread file.
 */
function readThreadFile(ctx: AgentChatParserContext, filePath: string): { thread: AmpThread; raw: string } | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (typeof data.id !== 'string' || typeof data.created !== 'number' || !Array.isArray(data.messages)) {
      ctx.log.debug('amp: thread validation failed — missing id, created, or messages', filePath);
      return null;
    }
    return { thread: data as AmpThread, raw };
  } catch (err) {
    ctx.log.debug('amp: failed to parse thread file', filePath, err);
    return null;
  }
}

function parseThreadFile(ctx: AgentChatParserContext, filePath: string): AmpThread | null {
  return readThreadFile(ctx, filePath)?.thread ?? null;
}

function extractMessageText(message: AmpMessage): string {
  return extractTextFromBlocks(message.content).trim();
}

/**
 * Extract the first real user message for use as a session summary
 */
function extractFirstUserMessage(thread: AmpThread): string {
  for (const msg of thread.messages) {
    if (msg.role === 'user') {
      const text = extractMessageText(msg);
      if (text) return text;
    }
  }
  return '';
}

/**
 * Extract model identifier from env.initial.tags (e.g. "model:claude-opus-4-5-20251101" → "claude-opus-4-5-20251101")
 */
function extractModel(thread: AmpThread): string | undefined {
  const tags = thread.env?.initial?.tags;
  if (!Array.isArray(tags)) return undefined;

  for (const tag of tags) {
    if (typeof tag === 'string' && tag.startsWith('model:')) {
      return tag.slice('model:'.length);
    }
  }
  return undefined;
}

function extractAmpMetadata(thread: AmpThread): Pick<UnifiedSession, 'cwd' | 'repo' | 'branch' | 'gitSha'> {
  const firstTree = thread.env?.initial?.trees?.[0];
  const cwd = firstTree?.uri?.startsWith('file://') ? safeFileURLToPath(firstTree.uri) : '';
  const repo = extractRepo({ gitUrl: firstTree?.repository?.url, cwd });
  const ref = firstTree?.repository?.ref;
  const branch = ref?.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;

  return {
    cwd,
    ...(repo ? { repo } : {}),
    ...(branch ? { branch } : {}),
    ...(firstTree?.repository?.sha ? { gitSha: firstTree.repository.sha } : {}),
  };
}

/**
 * Parse all Amp sessions
 */
export async function parseAmpSessions(ctx: AgentChatParserContext): Promise<UnifiedSession[]> {
  const files = findSessionFiles(ctx);
  const sessions: UnifiedSession[] = [];

  for (const filePath of files) {
    try {
      const parsed = readThreadFile(ctx, filePath);
      if (!parsed || !parsed.thread.id) continue;
      const { thread } = parsed;

      const firstUserMessage = extractFirstUserMessage(thread);
      if (!thread.title && !firstUserMessage) continue;
      const metadata = extractAmpMetadata(thread);
      const fileStats = fs.statSync(filePath);

      sessions.push({
        id: thread.id,
        source: 'amp',
        cwd: metadata.cwd || '',
        repo: metadata.repo,
        branch: metadata.branch,
        gitSha: metadata.gitSha,
        createdAt: new Date(thread.created),
        updatedAt: new Date(fileStats.mtimeMs),
        originalPath: filePath,
        model: extractModel(thread),
      });
    } catch (err) {
      ctx.log.debug('amp: skipping unparseable thread', filePath, err);
    }
  }

  return sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/**
 * Extract visible messages from an Amp session.
 */
export async function extractAmpContext(
  ctx: AgentChatParserContext,
  session: UnifiedSession,
): Promise<ParsedAgentConversation> {
  const thread = parseThreadFile(ctx, session.originalPath);
  const messages: MessageDraft[] = [];

  if (thread) {
    const metadata = extractAmpMetadata(thread);
    const enrichedSession: UnifiedSession = {
      ...session,
      cwd: session.cwd || metadata.cwd || '',
      repo: session.repo || metadata.repo,
      branch: session.branch || metadata.branch,
      gitSha: session.gitSha || metadata.gitSha,
      model: session.model || extractModel(thread),
    };

    for (const msg of thread.messages) {
      const text = extractMessageText(msg);
      if (!text) continue;

      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({
          role: msg.role,
          content: text,
          timestamp: new Date(msg.meta?.sentAt ?? thread.created),
          sourceId: String(msg.messageId),
        });
      }
    }

    return {
      session: enrichedSession,
      messages: sequenceMessages(messages),
    };
  }

  return {
    session,
    messages: [],
  };
}
