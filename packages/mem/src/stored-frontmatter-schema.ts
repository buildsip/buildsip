import { z } from "zod";
import { frontmatterSchema } from "./frontmatter-schema";
import { scopeSchema } from "./scope-schema";

/** Saved memories require an ID; omitted scope inherits the owning store's scope. */
export const storedFrontmatterSchema = frontmatterSchema.extend({
  id: z
    .string({ error: "Expected a nonempty string identifying the memory." })
    .min(1, "Expected a nonempty string identifying the memory.")
    .regex(/\S/, "Expected a nonempty string identifying the memory."),
  scope: scopeSchema.optional(),
});
