import * as os from 'node:os';
import * as path from 'node:path';
import type { Message } from '../types/index';
import { extractRepoFromGitUrl } from './content';

export type MessageDraft = Omit<Message, 'sequence'> & { sequence?: number };

/**
 * Clean and truncate text for use as a session summary.
 * Collapses whitespace and newlines into a single line.
 */
export function cleanSummary(text: string, maxLen = 50): string {
  return text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

/**
 * Extract a short repo identifier from a working directory path.
 * Returns the last two path components joined with '/'.
 */
export function extractRepoFromCwd(cwd: string): string {
  if (!cwd) return '';
  const parts = cwd.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return parts.slice(-2).join('/');
  }
  return parts[parts.length - 1] || '';
}

/**
 * Extract a repo identifier from a git URL (preferred) or fall back to cwd-based derivation.
 * Merges codex's extractRepoName + extractRepoFromCwd into one function.
 */
export function extractRepo(opts: { gitUrl?: string; cwd?: string }): string {
  if (opts.gitUrl) {
    const fromUrl = extractRepoFromGitUrl(opts.gitUrl);
    if (fromUrl) return fromUrl;
  }
  return extractRepoFromCwd(opts.cwd || '');
}

/**
 * Get the user's home directory reliably.
 * Preferred over `process.env.HOME || '~'` which doesn't expand on all platforms.
 */
export function homeDir(): string {
  return os.homedir();
}

/** Replace home directory prefix with ~ and escape backticks for safe inline display. */
export function safePath(p: string): string {
  const home = os.homedir();
  const tildified = p === home || p.startsWith(`${home}${path.sep}`) ? `~${p.slice(home.length)}` : p;
  return tildified.replace(/`/g, '\\`');
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function sequenceMessages(messages: MessageDraft[]): Message[] {
  return messages.map((message, index) => ({ ...message, sequence: message.sequence ?? index }));
}
