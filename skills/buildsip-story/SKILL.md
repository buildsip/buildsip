---
name: buildsip-story
description: Create a work story.
---

1. Run `pnpm buildsip prepare` (defaults to the last 7 days). For a different window, use `--hours <hours>`, `--days <days>`, `--since <iso>`, or `--until <iso>`. Keep the JSON result because it contains `temp`, `tempDir`, `tempLogsDir`, and `until`.

2. From now on, only read `*.jsonl` files inside the returned `tempLogsDir`. Do not use unfiltered BuildSip logs.

3. Spawn a subagent with these instructions:

> Read `*.jsonl` files inside the returned `tempLogsDir`. Write one Markdown file per story inside the returned `tempDir`. Use filename slugs based on each title, such as `title-of-story-1.md`, `title-of-story-2.md`, and so on. Follow the [STORY.md](<absolute path to STORY.md>) instructions. If nothing clears the **substance bar**, stop here and report that clearly. Here are the paths to the folders mentioned prior: ...

Make sure you feed it the paths from the prepare command and the absolute path to [STORY.md](./STORY.md).

4. Spawn a subagent to audit the story files with this instruction:

> Audit whether the BuildSip story files respect the rules from the adjacent [STORY.md](<absolute path to STORY.md>). Return findings as normal agent output. Do **not** rewrite the files. If nothing is wrong, say so clearly.

If the audit fails, skip to cleanup.

5. Revise the story files if the audit returned findings. Follow [STORY.md](./STORY.md) rules.

6. Build a numbered list of markdown links, using each story's path as the link target, then ask the user whether they'd like changes or want you to proceed with the upload.

- If they request changes, make them now, at this step. Follow the rules in [STORY.md](./STORY.md), but if they conflict with the user's request, prioritize the user.
- CRITICAL: Only proceed to the next step once the user explicitly approves the upload.

7. Run `pnpm buildsip upload <temp from prepare JSON> --until <until from prepare JSON>` to upload the story Markdown files.

8. Run `pnpm buildsip cleanup <temp from prepare JSON>`.

# Output

The draft link and the time window used.
