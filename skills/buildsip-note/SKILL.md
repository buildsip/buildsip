---
name: buildsip-note
description: Create and publish an implementation note.
---

1. Run `pnpm buildsip prepare` (defaults to the last 7 days). For a different window, use `--hours <hours>`, `--days <days>`, `--since <iso>`, or `--until <iso>`. Keep the JSON result because it contains `temp`, `tempDir`, `tempLogsDir`, and `until`.

2. From now on, only read `*.jsonl` files inside the returned `tempLogsDir`. Do not use unfiltered BuildSip logs.

3. Spawn a subagent with these instructions:

> Read `*.jsonl` files inside the returned `tempLogsDir`. Write one Markdown file per note inside the returned `tempDir`. Use filename slugs based on each title, such as `title-of-note-1.md`, `title-of-note-2.md`, and so on. Follow the [NOTE.md](<absolute path to NOTE.md>) instructions. If nothing clears the **substance bar**, stop here and report that clearly. Here are the paths to the folders mentioned prior: ...

Make sure you feed it the paths from the prepare command and the absolute path to [NOTE.md](./NOTE.md).

4. Spawn a subagent to audit the note files with this instruction:

> Audit whether the BuildSip note files respect the rules from the adjacent [NOTE.md](<absolute path to NOTE.md>). Return findings as normal agent output. Do **not** rewrite the files. If nothing is wrong, say so clearly.

5. Revise the note files if the audit returned findings. Follow [NOTE.md](./NOTE.md) rules.

6. Build a numbered list of markdown links, using each note's path as the link target, and then ask the user whether they'd like changes or want you to proceed with the upload. If a note includes a warning, note it next to the markdown link like this: "[title](link) — **⚠️ Privacy warning**".

- If they request changes, make them now, at this step. Follow the rules in [NOTE.md](./NOTE.md), but if they conflict with the user's request, prioritize the user.
- CRITICAL: Only proceed to the next step once the user explicitly approves the upload.

7. Run `pnpm buildsip upload <temp from prepare JSON> --until <until from prepare JSON>` to upload the note Markdown files.

8. Run `pnpm buildsip cleanup <temp from prepare JSON>`.

# Output

The draft link and the time window used.
