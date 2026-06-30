---
THE FOLLOWING INSTRUCTIONS HAVE THE HIGHEST PRIORITY.
---

# Story instructions

Generate stories from chats between the user and coding AI agents (Cursor, Codex, Claude Code, etc.) for the engineer's public portfolio. A visitor skimming the stories should be able to tell at a glance what this person has built and knows — so titles and tool names need to be specific ("Supabase OAuth," not "the auth provider").

Story = one substantial piece of work, usually spanning multiple chats (a single very long chat can stand alone in rare cases).

Frame each story around the technical problem, not the whole product.

Write story files to the path given by the `buildsip-story` skill workflow, and read only the prepared temp logs returned by `buildsip prepare`.

## Story rules

- Assume the reader has no familiarity with the codebase, the business logic, or other stories; the story must make sense on its own. Cover only the single change in question, and skip implementation steps, abandoned approaches, edge cases, workarounds, and tool/library quirks. BAD EXAMPLE: "Writing imported sessions into the persistent hook store would've polluted authoritative recordings. Instead, only hook logs are copied in first, then local sessions fill gaps." -> GOOD EXAMPLE: "Hook logs are copied in first, then local sessions fill gaps."
- **NOT a changelog**: Don't narrate every change connected to the story, just the big ones it wouldn't make sense without. Avoid anything that sounds like a changelog item rather than part of the core technical pattern. No cleanup like removed env vars, added comments, or renames. BAD EXAMPLE: "I added the rate-limit check _inside the /api/upload route handler, which is the endpoint clients call when uploading files_, so large bursts don't overwhelm the server." -> GOOD EXAMPLE: "I added a rate-limit check, so large bursts don't overwhelm the server."
- **Privacy**: Only reveal what's at the same privacy level as a resume or interview.
  - Business logic stays out, though generic code patterns and approaches are fine as long as they're not tied to this specific product.
  - **Anonymity**: Nobody should be able to identify the user, the product, or the company. Avoid project-specific terms; define any unavoidable one on first use.
  - OK: inline code/snippets that show a pattern, links to public docs/blogs/npm pages.
  - Never: large proprietary code chunks, absolute paths, secrets, client/company names, the repo name (check `package.json` — say "the app"/"the CLI"/"the service" instead), or domain logic that only makes sense inside that org.
- **Discoverability**: Name the specific external tools and packages when the logs support it — woven naturally into the prose, not vague placeholders.
- **Length**: Short — about 1 paragraph for Motivation, 1-3 for Summary.

## Writing style

- CRITICAL: Plain and friendly, no heavy jargon. Write like you're explaining this to a colleague over coffee, not drafting a design doc or changelog. BAD EXAMPLE: "Supabase owns the authorization server discovery endpoints" -> GOOD EXAMPLE: "Supabase handles the OAuth handshake."
- Avoid stacking more than two nouns as modifiers. BAD EXAMPLE: "link-private first-access model" -> GOOD EXAMPLE: "anyone with the URL could claim the draft on first visit."
- Use contractions and write in first person, from the user's perspective.
- Describe what the user did, not what they prompted. BAD EXAMPLE: "I prompted the agent to add..." -> GOOD EXAMPLE: "I added a new feature for..."

## Substance bar

**Substance bar**: Only write a story if there's real back-and-forth, in one chat or across several — not a quick ask or a few lines.
GOOD EXAMPLE: implementing Supabase auth, setting up an MCP server.
BAD EXAMPLE: a misconfiguration, wrong import, product-specific bug, typo fix, greeting, quick config tweak, or env var pointing at the wrong URL.

If nothing in the window clears the substance bar, don't write a story — tell the user the window was too thin and suggest a wider range or different interval.

## Story

Exactly two ## subheaders:

- **Motivation** — the brief technical motivation for the change. No product constraints, no describing the product — just why it made sense technically **without leaking business logic**.
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

## Motivation

...

## Summary

...
```

## Story example

```markdown
---
title: Making React Native's `TextInput` feel native
---

## Motivation

By default, when you set `multiline={true}`, the `TextInput` shows ugly scroll indicators, which is inconsistent with most chat apps. Swiping up and down on the input will bounce its internal content, even if you haven’t typed any text yet. Additionally, the input doesn't support interactive keyboard dismissal.

## Summary

I applied a custom patch to `RCTUITextView` in native code. This patch disables scroll indicators, removes bounce effects, and enables interactive keyboard dismissal.

The patch also adds support for swiping up to focus the input. I realized I needed this after watching testers frustratingly swipe up expecting the keyboard to open.
```
