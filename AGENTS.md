- Your language should be plain, grounded, natural and easy to understand.
- Variable naming rules: make it simple & short, use honest verbs, and `CONTEXT.md` terminology. If a file only exports one entity, name the file after it, e.g. `export getStuff` => `get-stuff.ts`.
- No unnecessary helpers. Avoid extracting the following into variables/helper functions if they're only used in one place: functions that aren't generic, simple/small conditions or zod schemas. DO NOT do this (instead, just put the contents inline if only used in one place):

  ```tsx
  export const uploadResponseSchema = z.object({
    draftLink: z.url(),
  });
  ```

  Ask yourself - could this helper be a one liner? Then don't build it.