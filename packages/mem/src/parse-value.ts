import { z } from "zod";

/** Exposes nested union failures and unknown keys before Zod formats their messages and paths. */
function expand({
  issues,
  path,
}: {
  issues: z.core.$ZodIssue[];
  path: PropertyKey[];
}): { message: string; path: PropertyKey[] }[] {
  return issues.flatMap((issue) => {
    const field = [...path, ...issue.path];
    if (issue.code === "invalid_union") {
      // Union branches use paths relative to the union, not the root input.
      return issue.errors.flatMap((issues) => expand({ issues, path: field }));
    }
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => ({ message: issue.message, path: [...field, key] }));
    }
    return [{ message: issue.message, path: field }];
  });
}

/** Parses untrusted data and gives the agent each incorrect field and its expected value. */
export function parseValue<T>({
  schema,
  value,
  label,
  path = [],
}: {
  schema: z.ZodType<T>;
  value: unknown;
  label: string;
  path?: PropertyKey[];
}): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = expand({ issues: result.error.issues, path });
    throw new Error(`Invalid ${label}:\n${z.prettifyError({ issues })}`);
  }
  return result.data;
}
