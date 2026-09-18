import { z } from "zod";

/** Shared editable metadata; each caller adds its own scope and ID requirements. */
export const frontmatterSchema = z.looseObject(
  {
    title: z
      .string({ error: "Expected a nonempty string for the memory title." })
      .min(1, "Expected a nonempty string for the memory title.")
      .regex(/\S/, "Expected a nonempty string for the memory title.")
      .describe("Memory title. The memory directory is named from this title."),
    doNotEdit: z
      .boolean({ error: "Expected a boolean: true or false." })
      .optional()
      .describe("When true, agents cannot edit this memory."),
    doNotDelete: z
      .boolean({ error: "Expected a boolean: true or false." })
      .optional()
      .describe("When true, agents cannot delete this memory."),
  },
  {
    error: "Expected an object containing memory metadata, such as title and protection flags.",
  },
);
