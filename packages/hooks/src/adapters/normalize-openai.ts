import type { Input, Result } from "../types";
import { openaiEventInputSchema } from "./openai-schema";

export function normalizeOpenAI<const TName extends string>(
  input: unknown,
  name: TName,
): Result<Input<TName, "Stop" | "UserPromptSubmit">> {
  const result = openaiEventInputSchema.safeParse(input);

  if (!result.success) {
    return { data: null, error: result.error };
  }

  if (result.data.hook_event_name === "UserPromptSubmit") {
    return {
      data: {
        cwd: [result.data.cwd],
        eventName: "UserPromptSubmit",
        message: {
          content: result.data.prompt,
          role: "user",
        },
        model: result.data.model ?? null,
        name,
        sessionId: result.data.session_id,
      },
      error: null,
    };
  }

  if (result.data.last_assistant_message === null) {
    return { data: null, error: null };
  }

  return {
    data: {
      cwd: [result.data.cwd],
      eventName: "Stop",
      message: {
        content: result.data.last_assistant_message,
        role: "assistant",
      },
      model: result.data.model ?? null,
      name,
      sessionId: result.data.session_id,
    },
    error: null,
  };
}
