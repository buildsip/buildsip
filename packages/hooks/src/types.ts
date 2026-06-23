import type { z } from "zod";

export type Role = "assistant" | "user";

export type EventName = "Stop" | "UserPromptSubmit";

export type Message = {
  content: string;
  role: Role;
};

export type Input<TName extends string = string, TEventName extends string = string> = {
  cwd: string[];
  eventName: TEventName;
  message: Message;
  model: string | null;
  name: TName;
  sessionId: string;
};

export type UnknownAdapterError = {
  type: "unknown-adapter";
  name: string;
};

export type Result<T> =
  | {
      data: T;
      error: null;
    }
  | {
      data: null;
      error: z.ZodError;
    }
  | {
      data: null;
      error: UnknownAdapterError;
    }
  | {
      data: null;
      error: null;
    };

export type Adapter = {
  label: string;
  name: string;
  globalPath: string;
  parse(input: unknown): Result<Input>;
};
