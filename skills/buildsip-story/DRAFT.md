---
THE FOLLOWING INSTRUCTIONS HAVE THE HIGHEST PRIORITY.
---

# Story instructions

Generate stories from chats between the user and coding AI agents (Cursor, Codex, Claude Code, etc.) for the engineer's public portfolio. A visitor skimming the stories should be able to tell at a glance what this person has built and knows — so titles and tool names need to be specific ("Supabase OAuth," not "the auth provider").

Story = **one** reusable piece of technical insight, generated from multiple chats (a single very long chat can also work in rare cases).

Write story files to the path given by the `buildsip-story` skill workflow, and read only the prepared temp logs returned by `buildsip prepare`.

## Story rules

Golden rule: Strip each story down until it only communicates **reusable technical insight**. BAN project-specific context.

- Assume the reader has no familiarity with the codebase, the business logic, or other stories; the story must make sense on its own. Cover only the single change in question, and skip implementation steps, abandoned approaches, edge cases, workarounds, and tool/library quirks. BAD EXAMPLE: "Writing imported sessions into the persistent hook store would've polluted authoritative recordings. Instead, only hook logs are copied in first, then local sessions fill gaps." -> GOOD EXAMPLE: "Hook logs are copied in first, then local sessions fill gaps."
- **NOT a changelog**: Don't narrate every change connected to the story, just the big ones it wouldn't make sense without. Avoid anything that sounds like a changelog item rather than part of the core technical pattern. No cleanup like removed env vars, added comments, or renames. BAD EXAMPLE: "I added the rate-limit check _inside the /api/upload route handler, which is the endpoint clients call when uploading files_, so large bursts don't overwhelm the server." -> GOOD EXAMPLE: "I added a rate-limit check, so large bursts don't overwhelm the server."
- **Privacy**: Only reveal what's at the same privacy level as a resume or interview.
  - CRITICAL: **BAN internal vocabulary and business logic**. Never use words whose meaning depends on knowing the repository or product, e.g. internal commands, flags, environment variables, routes, events, and product-specific concepts. Generic code patterns and approaches are fine as long as they're not tied to this specific product.
  - **Anonymity**: Nobody should be able to identify the user, the product, or the company.
  - OK: inline code/snippets that show a pattern, links to public docs/blogs/npm pages.
  - Never: large proprietary code chunks, absolute paths, secrets, client/company names, the repo name (check `package.json` — say "the app"/"the CLI"/"the service" instead), or domain logic that only makes sense inside that org.
- **Discoverability**: Naturally weave the specific external tools and packages into the prose when the logs support it.
- **Length**: Short, max 1 paragraph for Problem, 1-3 for Summary.

## Writing style

- CRITICAL: Plain and friendly, no heavy jargon. Write like you're explaining this to a colleague over coffee, not drafting a design doc or changelog. BAD EXAMPLE: "Supabase owns the authorization server discovery endpoints" -> GOOD EXAMPLE: "Supabase handles the OAuth handshake."
- Avoid stacking more than two nouns as modifiers. BAD EXAMPLE: "link-private first-access model" -> GOOD EXAMPLE: "access was controlled by possession of a private URL"
- Use contractions and write in first person, from the user's perspective.
- Describe what the user did, not what they prompted. BAD EXAMPLE: "I prompted the agent to add..." -> GOOD EXAMPLE: "I added a new feature for..."

## Substance bar

**Substance bar**:

1. Only write a story if there's real back-and-forth, in one chat or across several — not a quick ask or a few lines.
   GOOD EXAMPLE: implementing Supabase auth, setting up an MCP server.
   BAD EXAMPLE: a misconfiguration, wrong import, project-specific bug, typo fix, greeting, quick config tweak, or env var pointing at the wrong URL.
2. **You're allowed to turn chats that focus on project internals into stories**, but only when the result can be a **reusable insight** (e.g. redesigning a landing page can't be turned into a technical insight if it's mostly about writing sections/styling elements with tailwind). Because you're bad at judging whether the result could be a reusable insight, turn all product-specific work that meets rule 1 into stories (CRITICAL: **anonymize hard**), then reread them; if the results don't meet all substance bar rules, delete them. Make sure you remove internal vocabulary and internal business logic.

If nothing in the window clears this substance bar, don't write a story — tell the user the window was too thin and suggest a wider range or different interval.

## Story

Exactly two ## subheaders:

- **Problem** — the brief technical problem that caused the change. No product constraints, no describing the product, just write why it made sense technically.
- **Summary** — how the change affects clients/end-users, framed around the technical problem rather than the product's internal concepts. Briefly describe the solution in terms a reader could reuse elsewhere without seeing the code diff and without addressing the reader directly.

### Title

Name the main tool, and spell out the effect of the change too if it isn't obvious from the implementation alone.

- BAD EXAMPLE (generic, no tool named): "Add a mutex to guard the database handle"
- GOOD EXAMPLE (tool + non-obvious effect):
  - "Prevent Supabase corruption during simultaneous sign-ups via a mutex guard"
  - "Exposing Supabase data to AI agents via an MCP server"
- GOOD EXAMPLE (obvious effect is skipped): "Implementing OAuth with Neon"

## Story file format

```markdown
---
title: Story title
---

## Problem

...

## Summary

...
```

## Story example

```markdown
---
title: Making React Native's `TextInput` feel native
---

## Problem

By default, when you set `multiline={true}`, the `TextInput` shows ugly scroll indicators, which is inconsistent with most chat apps. Swiping up and down on the input will bounce its internal content, even if you haven’t typed any text yet. Additionally, the input doesn't support interactive keyboard dismissal.

## Summary

I applied a custom patch to `RCTUITextView` in native code. This patch disables scroll indicators, removes bounce effects, and enables interactive keyboard dismissal.

The patch also adds support for swiping up to focus the input. I realized I needed this after watching testers frustratingly swipe up expecting the keyboard to open.
```
