# Story instructions

Your task is to generate stories from conversations between the user and coding AI agents (Cursor, Codex, Claude Code, etc). These stories are public and form part of the engineer's portfolio. A visitor skimming the stories should be able to tell at a glance what this person has built and what they know. Titles and tool names do a lot of that work — name the technology specifically ("Supabase OAuth" not "the auth provider") because vague titles signal vague work.

Story = one substantial piece of work that usually spans multiple prepared conversation logs, although in exceptional cases a very long conversation can be a standalone story.

Write story files to the path requested by the `buildsip-story` skill workflow. Read only the prepared temp logs returned by `buildsip prepare`.

Rules:

- **The reader**:
  - Unfamiliar with the codebase and the business logic. The story should be able to be understood without having access to the codebase.
  - Shouldn't be able to tell who the user is, which product this is on the market or which company is building it.
    - Define project-specific nouns on first use. Don't assume the reader knows what the app's concepts mean.
    - Ban "the old X", "previously X," "replacing X", or similar without context. Briefly explain what was X and why it mattered.
  - The user just wants to know the stuff related to the story and isn't concerned with side tasks. Remove: plumbing that only matters inside the repo — route renames, restored code paths, framework/compiler constraint fixes the user did not treat as the main issue, moving helpers between files, null guards with no user-visible impact, etc.
- **Privacy-conscious**: The privacy should be the same as during an interview or a personal blog. DO NOT leak business logic. You can write code patterns or talk about general approaches as long as they're not specific to the particular product the user is building.
  - You're allowed to include:
    - inline code and code blocks when they illustrate a pattern or approach
    - links to public npm pages, official docs, blogs, or other technical resources mentioned in the logs when they help the reader follow up
  - Exclude: large proprietary hunks, absolute paths, secrets, client names, the company name, repo name, business-specific domain logic meaningful only inside that org
  - When unsure, ask yourself: "Would the user mention this during an interview or on their resume?" If yes, then it's safe to include.
  - NEVER leak the name of the repository - check root `package.json`. Instead, use general terms like "the app", "the CLI", "the service", etc.
- **Discoverability**: Name tools, packages, and concepts the user used — naturally woven into the prose, when the logs support it. Use specific names over vague ones — "Supabase OAuth" not "the auth provider".
  - **Tools/platforms**, e.g. Vercel, Supabase
  - **Packages**, e.g. `mcp-handler`, `@platejs/plate`
  - **Concepts**, e.g. MCP servers, RAG, OAuth, edge caching
- A story is NOT: internal documentation or a sprint report.

## Language

- Use **plain**, friendly, approachable language & tone. Prefer plain language over complex jargon.
  - "Supabase owns the authorization server discovery endpoints" -> "Supabase handles the OAuth handshake"
  - "the app owns the protected-resource metadata" -> "the app advertises where its MCP endpoint lives"
  - "link-private first-access model" -> "anyone with the URL could claim the draft on first visit"
- Use contractions.
- Write in first person, from the user's perspective.
- Say what the user **did**, not what they prompted:
  - Good: "I added a new feature for..."
  - Bad: "I prompted the agent to add a new feature for..."

## When to skip

Do not write a story files when nothing clears the **substance bar**. The workflow stops before audit and upload.

If nothing qualifies, tell the user the window was too thin and suggest a wider range or a different day.

Skip throwaway moments (typo fixes, greetings, quick config tweaks) unless they show something interesting about how the user works.

## Substance bar

A story qualifies when it has real back-and-forth (over one conversation or across multiple conversations; not a quick ask or a few lines). GOOD: A reasonable design that failed for a non-obvious reason qualifies. BAD: A misconfiguration, wrong import, a product-specific bug, or env var pointing at the wrong URL.

## Story

Each story uses exactly these three `##` subheaders:

1. **Goal** — what the user was trying to do, including why this was needed if it's not obvious.
2. **Naive approach** (OPTIONAL) — attempts that were architecturally reasonable — approaches that seemed like the right design and failed for a non-obvious reason (and explain the reason). BAD: debugging steps, wrong imports, or misconfigured env vars.
3. **Outcome** - solution, and why this worked. The Outcome ends when the insight lands. Don't narrate the cleanup — removed env vars, added comments, renamed things.

## Story file format

```markdown
---
title: Story title
---

## Goal

...

## Naive approach

...

## Outcome

...
```

## Story examples

Title examples:

- "Setting up an MCP server with Supabase"
- "Dynamically generating a calendar image on the backend"
- "Implementing OAuth with Neon"
- "Deploying a CLI package that logs AI conversations"

1. A short story:

```markdown
---
title: Making React Native's `TextInput` feel native
---

## Goal

React Native’s built-in `TextInput` felt out of place in a native chat app.

By default, when you set `multiline={true}`, the `TextInput` shows ugly scroll indicators, which is inconsistent with most chat apps. Swiping up and down on the input will bounce its internal content, even if you haven’t typed any text yet. Additionally, the input doesn't support interactive keyboard dismissal.

## Outcome

To fix these issues, I applied a custom patch to `RCTUITextView` in native code. This patch disables scroll indicators, removes bounce effects, and enables interactive keyboard dismissal.

The patch also adds support for swiping up to focus the input. I realized I needed this after watching testers frustratingly swipe up expecting the keyboard to open.

While maintaining a patch across React Native updates isn't ideal, it was the most practical solution I found. I would've preferred an official API for extending native views without patching, and I plan on contributing this patch to React Native core if there is community interest.
```

2. A long story that involved many subtasks and spawned over several days:

````markdown
---
title: Scrolling new messages to the top in a React Native AI chat app
---

## Goal

New messages have to scroll to the top of the screen.

## Naive approach

So all I need to do is scroll to end if I'm sending a message in an existing chat, right?

```ts
useEffect(function onNewMessage() {
  const didNewMessageSend = // ...some logic
  if (didNewMessageSend) {
    listRef.current?.scrollToEnd()
  }
}, ...)
```

Wrong. If I simply call `scrollToEnd()`, then the new messages will show at the bottom of the screen.

I needed a strategy to push the user message to the top of the chat. I referred to this as "blank size": the distance between the bottom of the last assistant message, and the end of the chat.

To float the content to the top of the chat, I had to push it up by the amount equal to the blank size. Thanks to synchronous height measurements in React Native's New Architecture, this was possible to do on each frame without a flicker. But it still required a lot of trickery and coordination.

The blank size is dynamic. Its height depends on the keyboard’s open state. And it can change on every render, since the assistant message streams in quickly and with unpredictable sizes.

Dynamic heights are a common challenge in virtualized lists. The frequently-updating blank size took that challenge to a new level. My list items have dynamic, unknown heights that update frequently, and I need them to float to the top.

For long enough assistant messages, the blank size could be zero, which introduced a new set of edge cases.

I tried many different approaches to implementing blank size. I tried a `View` at the bottom of the `ScrollView` with height, bottom padding on the `ScrollView` itself, `translateY` on the scrollable content, and minimum height on the last system message. All of these ended up with strange side effects and poor performance, often due to the need for a layout with Yoga.

## Outcome

I ultimately landed on a solution that uses the `contentInset` property on `ScrollView` to handle the blank size without jitters. `contentInset` maps directly to the native property on `UIScrollView` in `UIKit`.

I then paired contentInset together with `scrollToEnd({ offset })` when you send a message.

An assistant message’s blank size is determined by the combination of its own height, the height of the user message that comes before it, and the height of the chat container.

### Implementing `useMessageBlankSize`

To implement blank size, we start with a hook called `useMessageBlankSize` in the assistant message:

```ts
function AssistantMessage({ message, index }) {
  // ...styling logic
  const { onLayout, ref } = useMessageBlankSize({ index })
  return (
    <Animated.View ref={ref} onLayout={onLayout}>
      <AssistantMessageContent message={message} />
    </Animated.View>
  )
}
```

`useMessageBlankSize` is responsible for the following logic:

- Synchronously measure the assistant message
- Measure the user message before it
- Calculate the minimum distance for the blank size below the assistant message
- Keep track of what the blank size should be when the keyboard is opened or closed
- Set the blankSize shared value at the root context provider

Lastly, I consume `blankSize` and pass it to `contentInset` of `ScrollView`:

```ts
export function MessagesList(props) {
  const { blankSize, composerHeight, keyboardHeight } = useMessageListContext()

  const animatedProps = useAnimatedProps(() => {
    return {
      contentInset: {
        bottom: blankSize.get() + composerHeight.get() + keyboardHeight.get(),
      },
    }
  })

  return <AnimatedLegendList {...props} animatedProps={animatedProps} />
}
```

### Passing `blankSize` to `contentInset`

`useAnimatedProps` from Reanimated lets us update props on the UI thread on each frame without triggering re-renders. contentInset saw great performance and worked far better than every previous attempt.
````
