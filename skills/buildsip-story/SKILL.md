---
name: buildsip-story
description: Create a work story.
---

1. Run `pnpm buildsip prepare` (defaults to the last 7 days). For a different window, use `--hours <hours>`, `--days <days>`, `--date <date>`, `--since <iso>`, or `--until <iso>`. Keep the JSON result because it contains `temp`, `tempDir`, `tempLogsDir`, and `until`.

2. From now on, only read `*.jsonl` files inside the returned `tempLogsDir`. Do not use unfiltered BuildSip logs.

3. Write one Markdown file per story inside the returned `tempDir`. Use filename slugs based on each title, such as `title-of-story-1.md`, `title-of-story-2.md`, and so on. Follow `DRAFT.md`.

   If nothing clears the **substance bar**, skip to the cleanup step.

4. Spawn a subagent to audit the story files with this instruction:

> Audit whether the BuildSip story files respect the rules from the adjacent `DRAFT.md`. Return findings as normal agent output. Do **not** rewrite the files. If nothing is wrong, say so clearly.

If the audit fails, skip to cleanup.

5. Revise the story files if the audit returned findings. Follow `DRAFT.md` rules.

6. Run `pnpm buildsip upload <temp from prepare JSON> --until <until from prepare JSON>` to upload the story Markdown files.

7. Run `pnpm buildsip cleanup <temp from prepare JSON>`.

# Output

The draft link and the time window used.
