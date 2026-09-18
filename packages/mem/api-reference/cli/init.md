# mem-cli init

`mem-cli init` writes [`.memories/config.json`](../file-conventions/config-json.md) and installs the global `mem-cli` CLI. Run it from anywhere inside a Git working tree.

Like every CLI invocation, it also refreshes [global MCP installation](../mcp/installation.md), even if memory reconfiguration is skipped.

```bash filename="Terminal"
mem-cli init
```

```bash filename="Terminal"
mem-cli init --verbose
```

## Reference

| Options | Description |
| --- | --- |
| `--verbose` | Print package-manager output while installing the CLI. |

`init` does not take [`--roots`](./index.md#--roots) or [`--repo`](./index.md#--repo).

### Target

The Git root is the directory that contains `.git`.

If that root has no `.memories/config.json`, init configures the Git root even when launched inside a nested package. An existing `.memories/` folder without that file does not count as repository setup.

Once the root config exists, init configures the nearest directory that contains `package.json`, walking up from the current working directory and stopping at the Git root. Starting in `apps/web/src` therefore configures `apps/web`.

Run init again from the same package after first-time repository setup to create that package's own config.

### Prompts

Existing memories and unrelated config keys are left alone. The target's config and inherited configs are validated before prompting.

| Prompt | When |
| --- | --- |
| Reconfigure this target? | The target already has a config. Default `false`. Answering no leaves memory settings unchanged. |
| Share this repository's memories with other projects in the workspace? | Configuring the Git root. Default is the current [`availableToWorkspace`](../config/availableToWorkspace.md) value, or `false`. |
| Enable pruning? | Always. Default is whether [`prune`](../config/prune.md) is currently an object. |
| Add memory tab labels to VS Code / Cursor? | Always. Default `true`. |

Canceling any prompt exits with `mem-cli init cancelled.`

If pruning is enabled and `MEMORIES_DATABASE_URL` is unset, init still writes the config and warns that the database is not configured.

### Written files

Root config always includes `version: 1` and `availableToWorkspace`. Package config omits `availableToWorkspace`.

Enabled [`prune`](../config/prune.md) uses init's default durations, keeping any existing durations already on the target. Disabled pruning is `false`.

Tab labels edit `.vscode/settings.json` at the Git root (JSONC comments are preserved):

```json
{
  "workbench.editor.customLabels.patterns": {
    "**/.memories/**/memory.md": "${dirname}/memory.md"
  }
}
```

`data/` is not created here. See [`data/`](../file-conventions/data.md).

### CLI install

Init installs `mem-cli` globally with the launcher that invoked it (`npx` → npm, `pnpm dlx` → pnpm, `bunx --bun` → bun). Direct invocation without launcher metadata uses npm. Yarn Berry uses npm for the global install; Yarn Classic uses `yarn global add`.

A private development package is installed from the running CLI directory. A published package is installed from the registry. If a newer release exists, init asks before upgrading.

## Examples

### First run inside a package

```bash filename="Terminal"
cd apps/web
mem-cli init
```

Writes `/repo/.memories/config.json`. The UI tells you to run init again from this package to configure it.

```bash filename="Terminal"
mem-cli init
```

Writes `/repo/apps/web/.memories/config.json` without `availableToWorkspace`.

### Reconfigure the Git root

```bash filename="Terminal"
cd /repo
mem-cli init
```

Confirms before overwriting that root config. Existing `memory.md` files stay.

## Related

- [`.memories/config.json`](../file-conventions/config-json.md)
- [`availableToWorkspace`](../config/availableToWorkspace.md)
- [`prune`](../config/prune.md)
