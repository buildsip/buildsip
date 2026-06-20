import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter } from "../../types";
import { cursorEventInputSchema } from "./schema";

export const cursor = {
  label: "Cursor",
  name: "cursor",
  globalPath: join(homedir(), ".cursor", "hooks.json"),
  parse(input: unknown) {
    const result = cursorEventInputSchema.safeParse(input);

    if (!result.success) {
      return { data: null, error: result.error };
    }

    if (result.data.hook_event_name === "beforeSubmitPrompt") {
      return {
        data: {
          cwd: result.data.workspace_roots,
          eventName: "UserPromptSubmit",
          message: {
            content: result.data.prompt,
            role: "user",
          },
          model: result.data.model,
          name: "cursor",
          sessionId: result.data.conversation_id,
        },
        error: null,
      };
    }

    return {
      data: {
        cwd: result.data.workspace_roots,
        eventName: "Stop",
        message: {
          content: result.data.text,
          role: "assistant",
        },
        model: result.data.model,
        name: "cursor",
        sessionId: result.data.conversation_id,
      },
      error: null,
    };
  },
} as const satisfies Adapter;
