import { z } from "zod";
import { insertSchema } from "./insert-schema";

/** Updates identify an existing memory by path and only replace fields that are supplied. */
export const updateSchema = z.strictObject(
  {
    path: z
      .string({ error: "Provide the path to an existing memory.md file or its directory." })
      .regex(/\S/, "Provide the path to an existing memory.md file or its directory.")
      .refine((path) => !path.includes("\0"), "Remove the NUL character from the memory path."),
    body: insertSchema.shape.body.optional(),
    frontmatter: z
      .looseObject(insertSchema.shape.frontmatter.partial().shape, {
        error:
          "Expected an object containing only frontmatter fields to change: title, scope, doNotEdit, doNotDelete, or configured custom fields. Omit id; the stored ID is preserved. Omit frontmatter entirely to keep it unchanged.",
      })
      .optional(),
  },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? "Remove this unknown field. Only path, body, and frontmatter are allowed at the top level. Put title, scope, protection flags, and configured custom fields inside frontmatter; omit id and pass workspace paths via --roots and --repo."
        : 'Expected one JSON object with an existing memory path, for example {"path":"/repo/.memories/data/memory-title/memory.md","body":"Updated content"}. Omit body or frontmatter fields to keep their current values.',
  },
);
