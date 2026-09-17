# Upvotes and pruning

- Upvotes are relevant when pruning memories. Ask the agent to upvote useful memories on your behalf. An upvote from a human counts more than an automatic upvote from an agent.
- Upvotes aren't recorded when a memory is read, only when a memory is useful.

## How it works

1. The AI calls the `prune-memories` tool, which returns a list of paths to the files that meet the [pruning conditions](./config.md#prune) from `config.json`.
2. The AI then analyses the memories by searching the repo and suggests a list of candidates to delete.
3. It's highly recommended to ask the agent to upvote the pruning candidates you decide to keep, so that they don't show up on your next pruning session.

## Disable upvotes and pruning

`config.json`:

```json
{
  "prune": false
}
```

## `.env` file

`mem-cli` resolves `.env` files by traversing upward from the active package directory to the repository root (`.git`).

Priority: `process.env` > package-level `.env` > repository root `.env`.
