import { UnknownSourceError } from '../errors';
import { adapters } from '../parsers/registry';
import type {
  AgentChatParserContext,
  ParsedAgentConversation,
  SessionParseOptions,
  UnifiedSession,
} from '../types/index';

/**
 * List sessions by scanning native tool storage read-only.
 */
export async function listSessions(
  ctx: AgentChatParserContext,
  options: SessionParseOptions = {},
): Promise<UnifiedSession[]> {
  const selectedAdapters = options.source ? [adapters[options.source]] : Object.values(adapters);
  const parseOptions = options.source ? { cwd: options.cwd, limit: options.limit } : { cwd: options.cwd };
  const results = await Promise.allSettled(selectedAdapters.map((adapter) => adapter.parseSessions(ctx, parseOptions)));

  const allSessions = results
    .filter((result): result is PromiseFulfilledResult<UnifiedSession[]> => result.status === 'fulfilled')
    .flatMap((result) => result.value);

  const sorted = allSessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return options.limit ? sorted.slice(0, options.limit) : sorted;
}

/**
 * Find a session by ID.
 */
export async function findSession(ctx: AgentChatParserContext, id: string): Promise<UnifiedSession | null> {
  const all = await listSessions(ctx);
  return all.find((session) => session.id === id || session.id.startsWith(id)) || null;
}

/**
 * Parse the full visible conversation for a session based on its source.
 */
export async function parseSession(
  ctx: AgentChatParserContext,
  session: UnifiedSession,
): Promise<ParsedAgentConversation> {
  const adapter = adapters[session.source];
  if (!adapter) throw new UnknownSourceError(session.source);
  return adapter.parseSession(ctx, session);
}

/**
 * Format session metadata for display/debugging.
 */
export function formatSession(session: UnifiedSession): string {
  const tag = `[${session.source}]`;
  const source = tag.padEnd(10);
  const date = session.updatedAt.toISOString().slice(0, 16).replace('T', ' ');
  const repo = (session.repo || session.cwd.split('/').pop() || '').slice(0, 20).padEnd(20);
  const branch = (session.branch || '').slice(0, 15).padEnd(15);
  const id = session.id.slice(0, 12);

  return `${source} ${date}  ${repo} ${branch} ${id}`;
}

/**
 * Format sessions as JSONL.
 */
export function sessionsToJsonl(sessions: UnifiedSession[]): string {
  return sessions
    .map((session) =>
      JSON.stringify({
        ...session,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
      }),
    )
    .join('\n');
}
