import { isAbsolute } from "node:path";
import { z } from "zod";
import { deleteMemories } from "./commands/delete-memories";
import { insert } from "./commands/insert";
import { search } from "./commands/search";
import { update } from "./commands/update";
import { insertSchema } from "./insert-schema";
import { parseValue } from "./parse-value";
import { scopeSchema } from "./scope-schema";
import { updateSchema } from "./update-schema";

const absolutePath = z
  .string({ error: "Provide an absolute directory path." })
  .refine(
    (path) => isAbsolute(path) && !path.includes("\0"),
    "Provide an absolute directory path without NUL characters.",
  );

const workspace = {
  roots: z
    .array(absolutePath, {
      error: "Provide roots as an array of absolute workspace directory paths.",
    })
    .min(1, "Include every workspace folder in roots; at least one is required.")
    .describe("Absolute paths of every workspace folder, including shared memory repositories."),
  repo: absolutePath.describe(
    "Git root of the active workspace project, inside one of roots. A package directory is not accepted.",
  ),
};

const memoryPath = z
  .string({ error: "Provide a path to an existing memory.md file or its directory." })
  .refine(
    (path) => Boolean(path.trim()) && !path.includes("\0"),
    "Provide a nonempty memory path without NUL characters.",
  )
  .describe(
    "Existing memory.md file or its directory. Prefer an absolute path returned by a memory tool; relative paths resolve from the server's working directory.",
  );
const inputError = (issue: { code: string }) =>
  issue.code === "unrecognized_keys"
    ? "Remove unknown top-level fields. Use only the fields listed in this tool's input schema; put configured custom fields inside frontmatter."
    : "Provide one object matching this tool's input schema, including roots and repo.";

/** Keeps each schema and its typed command together; callers can pass untrusted tool arguments. */
function tool<T>({
  name,
  description,
  schema,
  run,
  readOnly = false,
  destructive = false,
}: {
  name: string;
  description: string;
  schema: z.ZodType<T>;
  run: (input: T) => Promise<unknown>;
  readOnly?: boolean;
  destructive?: boolean;
}) {
  return {
    name,
    description,
    schema,
    annotations: { readOnlyHint: readOnly, destructiveHint: destructive, openWorldHint: false },
    call: (value: unknown) => run(parseValue({ schema, value, label: `${name} arguments` })),
  };
}

/** One registry supplies the server's schemas and the installer's named auto-approval list. */
export const mcpTools = [
  tool({
    name: "insert-memory",
    description:
      "Create one memory. Call search-memories first; if a related memory can be improved, use update-memory instead. Pass the narrowest scope that accurately covers this memory. Use * only when it applies to the whole repository. Keep the returned path for later edits.",
    schema: z.strictObject({ ...workspace, ...insertSchema.shape }, { error: inputError }),
    run: insert,
  }),
  tool({
    name: "update-memory",
    description:
      "Patch an existing memory. Reuse a path returned by search, insert, or update. Omitted fields keep their values. A scope or title change can move the memory; use the returned path for subsequent calls. Every update repairs the title folder. If doNotEdit blocks the update, ask the user to edit the memory.",
    schema: z.strictObject(
      { ...workspace, path: memoryPath, ...updateSchema.shape },
      { error: inputError },
    ),
    run: update,
    destructive: true,
  }),
  tool({
    name: "search-memories",
    description:
      "Search saved memories for context relevant to the current task. Prefer a narrow scope when working in a specific part of a repository. Read the returned memories and check their claims against the current code before relying on them.",
    schema: z.strictObject(
      {
        ...workspace,
        query: z
          .string({ error: "Provide a nonempty search query." })
          .regex(/\S/, "Provide a nonempty search query.")
          .describe(
            "Text to search in memory titles, frontmatter, directory tags, and Markdown bodies.",
          ),
        scope: z
          .array(scopeSchema, {
            error: "Provide scope as an array of repository-relative file or directory paths.",
          })
          .min(1, "Provide at least one scope, or omit scope to search the whole repo.")
          .optional()
          .describe(
            'Literal repository-relative file or directory paths; directories include descendants. Omit or use ["*"] or ["."] for the whole repo. No other wildcards.',
          ),
        limit: z
          .number({ error: "Provide limit as a positive integer, or omit it for 50 results." })
          .int("Provide limit as a safe integer.")
          .min(1, "Provide limit of at least 1.")
          .max(Number.MAX_SAFE_INTEGER, "Provide limit no greater than 9007199254740991.")
          .optional()
          .describe("Maximum number of ranked results. Positive integer; defaults to 50."),
        offset: z
          .number({ error: "Provide offset as a nonnegative integer, or omit it to start at 0." })
          .int("Provide offset as a safe integer.")
          .min(0, "Provide offset of at least 0.")
          .max(Number.MAX_SAFE_INTEGER, "Provide offset no greater than 9007199254740991.")
          .optional()
          .describe("Number of ranked results to skip. Nonnegative integer; defaults to 0."),
      },
      { error: inputError },
    ),
    run: search,
    readOnly: true,
  }),
  tool({
    name: "delete-memories",
    description:
      "Delete selected memories and their attachments. Reuse paths returned by memory tools. Check the selection carefully: deleting a folder also removes its attachments, and nested memories must be explicitly selected. A memory with doNotDelete blocks the entire batch; ask the user to delete protected memories.",
    schema: z.strictObject(
      {
        ...workspace,
        path: z
          .array(memoryPath, {
            error: "Provide path as an array of memory.md paths or their directories.",
          })
          .min(1, "Provide at least one memory path to delete.")
          .describe(
            "Memory files or directories to delete, including any nested memories. The whole batch is validated before deletion.",
          ),
      },
      { error: inputError },
    ),
    run: ({ path, ...input }) => deleteMemories({ ...input, paths: path }),
    destructive: true,
  }),
];
