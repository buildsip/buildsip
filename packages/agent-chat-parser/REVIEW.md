# REVIEW.md

Review checklist for `@buildsip/agent-chat-parser`.

## Critical Areas

- Read-only behavior: parsers must never modify files under user tool storage such as `~/.claude`, `~/.codex`, `~/.cursor`, or IDE application support directories.
- Visible text only: parsed `messages` should contain only user and assistant text visible in the original conversation.
- Metadata: keep useful cwd, repo, branch, git sha, model, timestamps, original path, and source id fields when available.
- Registry: every `SessionSource` in `TOOL_NAMES` must have a registered parser adapter.
- Source filtering: if a parser accepts `cwd`, verify it does not return unrelated project sessions.

## Things To Watch

- Reasoning records, tool calls, tool results, token usage, cost, and internal summaries should not be emitted as messages.
- Some tools store system/developer/environment text as user-like records. Filter those carefully.
- SQLite parsers should open databases read-only.
- Large JSONL files should be streamed or bounded where possible.
- Live integrations, app launches, or local RPC calls should be explicit and easy to disable.

## Testing

- Prefer small fixtures that prove the normalized public API.
- Add regression tests when a parser has special filtering rules.
- Keep tests independent of real user session files.
