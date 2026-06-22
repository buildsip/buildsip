/**
 * Canonical tool names and derived SessionSource type.
 * Adding a new tool: add the name here, then the compiler surfaces every location that needs updating.
 */

/** Ordered list of all supported tool names — single source of truth */
export const TOOL_NAMES = Object.freeze([
  'claude',
  'codex',
  'copilot',
  'gemini',
  'opencode',
  'droid',
  'cursor',
  'amp',
  'kiro',
  'crush',
  'cline',
  'roo-code',
  'kilo-code',
  'antigravity',
  'kimi',
  'qwen-code',
] as const);

/** Source CLI tool — derived from TOOL_NAMES, never defined manually */
export type SessionSource = (typeof TOOL_NAMES)[number];

export function isSessionSource(value: string): value is SessionSource {
  return (TOOL_NAMES as readonly string[]).includes(value);
}
