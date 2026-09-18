import { z } from "zod";
import { frontmatterSchema } from "./frontmatter-schema";
import { scopeSchema } from "./scope-schema";

const scopeMessage =
  'Expected a nonempty array of repository-relative file or directory paths, such as ["apps/web/auth"]. Use ["*"] only for memories that apply to the whole repository.';

/** New memories need their content and scope; the command generates their stable ID. */
export const insertSchema = z.strictObject(
  {
    body: z
      .string({ error: "Expected a nonempty string containing the Markdown body." })
      .regex(/\S/, "Expected a nonempty string containing the Markdown body.")
      .describe("Nonempty Markdown content for the memory."),
    frontmatter: z
      .looseObject(
        {
          ...frontmatterSchema.shape,
          id: z
            .never({ error: "Omit id. Insert generates it; update preserves the stored ID." })
            .optional()
            .describe("Omit this field. Insert generates the ID; update preserves it."),
          scope: z
            .array(scopeSchema, { error: scopeMessage })
            .min(1, scopeMessage)
            .describe(
              'Existing repository-relative file or directory paths. Use the narrowest scope that covers the memory; ["*"] means the whole repo.',
            ),
        },
        {
          error:
            'Expected an object with title (a nonempty string) and scope (a nonempty array, such as ["apps/web/auth"] or ["*"]). Optional fields: doNotEdit, doNotDelete, and configured custom fields. Omit id; it is generated automatically.',
        },
      )
      .describe(
        "Memory metadata: required title and scope, optional protection flags and custom fields allowed by the destination store's config. Omit id.",
      ),
  },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? "Remove this unknown field. Only body and frontmatter are allowed at the top level. Put title, scope, protection flags, and configured custom fields inside frontmatter; omit id and pass workspace paths via --roots and --repo."
        : 'Expected one JSON object: {"body":"Markdown content","frontmatter":{"title":"Memory title","scope":["apps/web/auth"]}}. Use ["*"] only for memories that apply to the whole repo.',
  },
);
