import { adapters } from "./adapters";
import type { EventName, Name } from "./adapters";
import type { Input, Result } from "./types";

export function parse(
  input: unknown,
  name: string | undefined,
): Result<Input<Name, EventName>> {
  const adapter = adapters.find((adapter) => adapter.name === name);

  if (!adapter) {
    return {
      data: null,
      error: { type: "unknown-adapter", name: name ?? "undefined" },
    };
  }

  return adapter.parse(input) as Result<Input<Name, EventName>>;
}
