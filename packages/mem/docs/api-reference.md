# API reference

`--roots` and `--repo` are required flags on `mem insert` and `mem update`.

Both write commands return a one-element JSON array containing the saved absolute `memory.md` path. Use that returned path for later calls, since an update can rename or move the folder.

## `mem init`

Run interactively from anywhere inside a Git working tree. If the Git root has no `.memories/config.json`, init configures that root, even when launched inside a nested package. An existing `.memories/` folder or package config alone does not count as repository setup. Existing memories and package configs are preserved.

Once the root config exists, init configures the nearest directory containing `package.json`, falling back to the Git root. Running from a package's `src/` directory therefore configures the package. Run init again from the same package after first-time repository setup to create its own `.memories/config.json`.

The target's config and inherited configs are validated before prompting. Init offers to reconfigure an existing target config, asks about pruning and editor tab labels, and asks about workspace sharing only when configuring the Git root. Use `--verbose` to print setup command output.

## `mem insert`

Read one JSON object from `--input <file>`, or from stdin when `--input` is omitted or `-`.

The JSON payload matches a memory file: `frontmatter` is the YAML header, `body` is the Markdown. The body, title, and nonempty scope array are required. Search for an existing related memory before inserting.

```json
{
  "frontmatter": {
    "title": "Axios retry duplication after reconnect",
    "scope": ["apps/web"],
    "anchors": ["packages/api/src/websocket.ts"]
  },
  "body": "Retry the client once after a reconnect; do not stack interceptors."
}
```

Writable built-in frontmatter fields are `title`, `scope`, `doNotEdit`, and `doNotDelete`. Extra fields go next to them, not in a nested object. Declare extras in [`frontmatter.custom`](./config.md#custom) in the Git root's `.memories/config.json`. Package configs cannot define or override this schema.

Do not supply `id`: insert generates it and update preserves it. Both commands reject it in their input.

Scope selects the deepest package or repo root containing every scoped path. Use `["*"]` only for repo-wide memories. If the store location expresses the whole scope, the saved frontmatter omits scope.

## `mem update`

Read one JSON object from `--input <file>`, or from stdin when `--input` is omitted or `-`.

Only `path` is required in the payload. It accepts an existing `memory.md` file or its directory; relative paths resolve from the CLI working directory. A missing path is an error and never creates a memory.

```json
{
  "path": "/repo/apps/web/.memories/data/axios-retry-duplication-after-reconnect/memory.md",
  "body": "Updated explanation."
}
```

`body`, `frontmatter`, and every writable field inside `frontmatter` are optional. Omitted values survive unchanged, including the body text, title, protection flags, custom fields, and scope. Supplied title and body must still be nonempty. Omitted scope preserves the current store; supplying scope recomputes placement using the same rules as insert.

For a title-only update:

```json
{
  "path": "/repo/apps/web/.memories/data/axios-retry-duplication-after-reconnect/memory.md",
  "frontmatter": {
    "title": "Axios reconnect retry"
  }
}
```

Custom fields are merged by field name; a supplied object or array replaces that field's value. `null` is a value, not a deletion instruction, and must be permitted by the configured custom schema. Removing fields is not supported by this command.

Every update derives the folder name from the resulting title and repairs a mismatch, even when only `path` is supplied. Attachments move with the memory, and ancestor tag folders remain intact. The saved ID never changes. Updates respect `doNotEdit`, reject destination collisions, and refuse folders containing other memories or `memory.md` directly inside `data/`. Writes validate custom fields against the repository root's schema before publication, including when scope moves a memory between packages; failed publication rolls back any folder move.
