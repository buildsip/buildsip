# mem CLI

The `mem` CLI reads and writes Git-native memories.

Basic usage:

```bash filename="Terminal"
mem [command] [options]
```

Running `mem` with no command prints help.

Requires Node.js `>=22.5.0`.

## Reference

| Options | Description |
| --- | --- |
| `-h` or `--help` | Show help. |
| `-V` or `--version` | Print the CLI version. |

### Commands

| Command | Description |
| --- | --- |
| [`init`](./init.md) | Initialize a Git root, then the nearest package. |
| [`search`](./search.md) | Search titles, frontmatter, directory tags, and bodies. |
| [`insert`](./insert.md) | Create one memory from JSON. |
| [`update`](./update.md) | Patch one existing memory from JSON. |
| [`delete`](./delete.md) | Delete memories and their attachments by path. |

### `--roots`

Required on every command except [`init`](./init.md). Workspace directories. Repeat the flag or pass multiple paths.

```bash filename="Terminal"
mem search --roots /workspace/app --roots /workspace/team --repo /workspace/app --query cache
```

Each path must be a directory. The CLI canonicalizes it with `realpath`. Duplicate roots are ignored.

### `--repo`

Required on every command except [`init`](./init.md). Git root of the workspace project the agent is working on.

`--repo` must be a directory, that Git root, and inside one of `--roots`. A package directory is rejected.

### `--input`

Optional on [`insert`](./insert.md) and [`update`](./update.md). Path to a JSON file. Omit it, or pass `-`, to read stdin.

Stdin must be piped. A TTY with no `--input` is an error.

JSON must be one object with double-quoted keys. Comments and trailing commas are rejected. A file path ignores stdin.

### Output

Successful `search`, `insert`, `update`, and `delete` print JSON on stdout and nothing on stderr.

Failures print `{ "error": "<message>" }` on stderr, set exit code `1`, and print nothing on stdout. [`init`](./init.md) prints the same message through its interactive UI instead of JSON.

Help and version do not use this error format.

Symbolic links under a command's repo are rejected.
