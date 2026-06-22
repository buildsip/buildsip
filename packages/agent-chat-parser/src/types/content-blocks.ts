/**
 * Shared visible text block type.
 */
import { z } from 'zod';

// ── Zod Schemas ─────────────────────────────────────────────────────────────

export const TextBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const ContentBlockSchema = TextBlockSchema;

// ── TypeScript Types ────────────────────────────────────────────────────────

export type TextBlock = z.infer<typeof TextBlockSchema>;
export type ContentBlock = z.infer<typeof ContentBlockSchema>;
