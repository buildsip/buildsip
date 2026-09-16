# Principles

## Knowledge about code has the same lifecycle as the code it describes

Memories live inside the Git branch where the work happens. They are committed alongside the code, reviewed in the same PR, and reverted if the code is reverted.

**Why**: Decoupled memory storage (external databases or detached background PRs) breaks Git atomicity. If a feature branch is abandoned or rolled back, its memory must not linger on main to poison future agent runs.

## Clean docs. No transcript hoarding

Store things that matter, like architectural decisions or library quirks.

**Why**: Before AI, engineers never recorded every Google search or 1-on-1 brainstorm meeting. Hoarding long chat transcripts is lazy architecture that leads to massive context pollution and hallucinations, and burns thousands of dollars on useless tokens.

## An allergy to context pollution

The best way to break an AI agent is to give it too much irrelevant context.

**Why**: LLMs suffer from attention dispersion. An agent editing `packages/billing` doesn't need context only relevant to `apps/mobile`.

## Write once, inherit everywhere

**Why**: A developer shouldn't copy-paste their team's guidelines in every single repo.
