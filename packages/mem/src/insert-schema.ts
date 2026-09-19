import { z } from "zod";
import { frontmatterSchema } from "./frontmatter-schema";
import { scopeSchema } from "./scope-schema";

/** New memories need their content and scope; the command generates their stable ID. */
export const insertSchema = z.strictObject(
  {
    body: z
      .string({ error: "Expected a nonempty string containing the Markdown body." })
      .min(1, "Expected a nonempty string containing the Markdown body.")
      .regex(/\S/, "Expected a nonempty string containing the Markdown body.")
      .describe("Markdown content for the memory."),
    frontmatter: frontmatterSchema
      .extend({ scope: scopeSchema })
      // Custom fields are allowed, but caller IDs must not pass through as custom metadata.
      .refine((value) => !Object.hasOwn(value, "id"), {
        path: ["id"],
        message: "Omit id. Update preserves the stored ID.",
      }),
  },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? "Remove this unknown field. Only body and frontmatter are allowed at the top level. Put title, scope, protection flags, and configured custom fields inside frontmatter; pass workspace paths via --roots and --repo."
        : 'Expected one JSON object: {"body":"Markdown content","frontmatter":{"title":"Memory title","scope":["apps/web/auth"]}}. Use ["*"] only for memories that apply to the whole repo.',
  },
);
