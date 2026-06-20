import { z } from "zod";

export const openaiInputSchema = z.looseObject({
  cwd: z.string(),
  model: z.string().optional(),
  session_id: z.string(),
});

export const openaiPromptInputSchema = openaiInputSchema.extend({
  hook_event_name: z.literal("UserPromptSubmit"),
  prompt: z.string().min(1),
});

export const openaiStopInputSchema = openaiInputSchema.extend({
  hook_event_name: z.literal("Stop"),
  last_assistant_message: z.string().nullable(),
});

export const openaiEventInputSchema = z.union([
  openaiPromptInputSchema,
  openaiStopInputSchema,
]);
