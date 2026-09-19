import { z } from "zod";
import { insertSchema } from "./insert-schema";
import { frontmatterSchema } from "./frontmatter-schema";
import { scopeSchema } from "./scope-schema";

/** Update JSON contains only changed memory fields; --path selects the existing memory. */
export const updateSchema = z.strictObject(
  {
    body: insertSchema.shape.body.optional(),
    frontmatter: frontmatterSchema
      .partial()
      .extend({ scope: scopeSchema.optional() })
      .refine((value) => !Object.hasOwn(value, "id"), {
        path: ["id"],
        message: "Omit id. Insert generates it; update preserves the stored ID.",
      })
      .optional(),
  },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? "Remove this unknown field. Only body and frontmatter are allowed at the top level. Pass the memory path via --path and workspace paths via --roots and --repo. Put title, scope, protection flags, and configured custom fields inside frontmatter."
        : 'Expected one JSON object, for example {"body":"Updated content"}. Pass the existing memory path via --path. Omit body or frontmatter fields to keep their current values; use {} for a folder-name repair.',
  },
);
