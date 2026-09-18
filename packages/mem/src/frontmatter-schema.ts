import { z } from "zod";
import { scopeSchema } from "./scope-schema";

/** Built-in fields are shared by stored YAML and memory command inputs; Ajv validates extra fields later. */
export const frontmatterSchema = z.looseObject(
  {
    id: z
      .string({ error: "Expected a nonempty string identifying the memory." })
      .regex(/\S/, "Expected a nonempty string identifying the memory."),
    title: z
      .string({ error: "Expected a nonempty string for the memory title." })
      .regex(/\S/, "Expected a nonempty string for the memory title.")
      .describe("Nonempty memory title. The memory directory is named from this title."),
    scope: z
      .union([
        scopeSchema,
        z
          .array(scopeSchema)
          .min(1, 'Expected at least one scope path; use ["*"] for the whole repo.'),
      ])
      .optional(),
    doNotEdit: z
      .boolean({ error: "Expected a boolean: true or false; omit to keep the current value." })
      .optional()
      .describe(
        "When true, agents cannot edit this memory. Omit to keep the current value on update.",
      ),
    doNotDelete: z
      .boolean({ error: "Expected a boolean: true or false; omit to keep the current value." })
      .optional()
      .describe(
        "When true, agents cannot delete this memory. Omit to keep the current value on update.",
      ),
  },
  {
    error:
      "Expected a frontmatter object containing id and title, with optional scope and protection flags.",
  },
);
