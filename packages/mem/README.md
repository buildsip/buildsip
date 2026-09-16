# About

Git-native memory for AI coding agents.

- Human inspectability ✅
- PR human-in-the-loop review ✅
- No vendor lock-in ✅
- No burning millions of tokens on garbage context ✅

If you want your agent to inherit personal, team, or organization details and project specifics at the same time, you're in the right place. 🚀

```bash
repo/
├── .memories/
├── apps/
│   ├── web
│   │   └── .memories/
│   └── mobile
│       └── .memories/
└── packages/
    └── auth
        └── .memories/
```

# Quickstart

## Step 1: Configure pruning (Optional)

Optional. Upvotes and pruning prevent your memories from getting stale:

- Upvotes: When a memory helps solve a task, it gets upvoted (by you or the agent). Each upvote extends its lifespan.
- Pruning: Unused memories expire over time if they're not upvoted, so your agent doesn't act on outdated rules.

The database stores these upvote events.

If you skip this, upvotes are disabled. The agent can still prune memories manually by searching your codebase to verify if the code they describe still exists.

### Option A: Self-Hosted

This must be configured in **every repository** where you want to enable pruning.

1. **Create a database:**

Spin up a PostgreSQL database. Could use **[Neon](https://neon.tech)** or **[Supabase](https://supabase.com)** for free.

> 💡 **Tip:** You can reuse the **same database connection string** across all your organization's repositories.

1. **Set the environment variable:**

In your `.env` file at the root of your repo (or you can use a secrets manager like [Doppler](https://www.doppler.com/), but make sure your agent harness has access to it too):

```bash
MEMORIES_DATABASE_URL="postgresql://user:password@..."
```

### Option B: mem-cli app (Coming Soon)

Don't want to manage a database?

- ⚡ Zero-config setup: No databases to create or manage.
- 📊 Team Dashboard: See your team's top useful gotchas, search trends, and memories approaching expiration.
- 🤖 Automated Pruning PRs: Automated monthly GitHub PRs that remove stale memories.

## Step 2: Separate project memories from personal, team, and/or organization memories (Optional)

Optional. This step is useful for teams. If you're a solo dev, you could skip to [Step 3](./README.md#step-3-installation).

1. Create one repo for each set of memories you want to keep separate. For example, you might create one per team, one shared across the company, and a personal repo for memories that only apply to you.
2. To "import" the memories, add the repos to your IDE **workspace** and to your agent harness **workspace**.
3. Install `mem-cli` in each repo:

```bash
npx mem-cli init
```

When asked if you want to make these memories available to other projects in this workspace, answer **yes**.

## Step 3: Install to project

Inside your **project**, run:

```bash
npx mem-cli init
```

Under the hood, this installs the CLI, the MCP tools, and configures your repo.

### Workspace example (for teams)

```bash
repo/
├── .memories/
├── apps/
└── packages/

adam-personal/         # separate Git repo, personal user memories
└── .memories/

acme-team-1-memories/  # separate Git repo
└── .memories/

acme-memories/         # separate Git repo
└── .memories/
```

# Note for npm package maintainers

Make sure you exclude `.memories` from what gets shipped to npm.