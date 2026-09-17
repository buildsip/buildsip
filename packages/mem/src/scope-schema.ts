import { z } from "zod";
import { normalizeScopes } from "./normalize-scopes";

/** Validate each path before deduplication so an error still points to its original array index. */
export const scopeSchema = z
  .string({
    error:
      'Expected a repository-relative file or directory path, such as "apps/web/auth", or "*" for the whole repo.',
  })
  .superRefine((scope, ctx) => {
    try {
      normalizeScopes([scope]);
    } catch (error) {
      ctx.addIssue({ code: "custom", message: (error as Error).message });
    }
  });
