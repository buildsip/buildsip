import { z } from "zod";

const cursorInputSchema = z.looseObject({
  conversation_id: z.string().min(1),
  hook_event_name: z.string(),
  model: z.string().min(1),
  workspace_roots: z.tuple([z.string().min(1)]).rest(z.string().min(1)),
});

export const cursorPromptInputSchema = cursorInputSchema.extend({
  hook_event_name: z.literal("beforeSubmitPrompt"),
  prompt: z.string().min(1),
});

export const cursorResponseInputSchema = cursorInputSchema.extend({
  hook_event_name: z.literal("afterAgentResponse"),
  text: z.string().min(1),
});

export const cursorEventInputSchema = z.union([cursorPromptInputSchema, cursorResponseInputSchema]);
