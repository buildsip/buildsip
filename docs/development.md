# Development

These are the internal instructions for developing and maintaining the BuildSip CLI.

## Set up

1. Install the workspace dependencies:

```bash
pnpm i
```

2. Create `packages/cli/.env` with:

```bash
BUILDSIP_INSTALL_MODE=link
```

`BUILDSIP_INSTALL_MODE=link` installs the local CLI package globally and installs the story skill
from this repository.

To use a locally running web app, also add:

```bash
BUILDSIP_URL=http://localhost:3000
```

The CLI uses the production OAuth client by default. Set `OAUTH_CLIENT_ID` only when developing
against a different OAuth client.

3. Build and initialize the local CLI:

```bash
pnpm --dir packages/cli buildsip init
```

If pnpm reports that its configured global bin directory is not in `PATH`, run:

```bash
pnpm setup
```

Then restart the shell and initialize the CLI again.

To remove only the globally linked CLI package:

```bash
pnpm remove -g buildsip
```

## Build and check changes

Build the CLI after making changes:

```bash
pnpm --dir packages/cli build
```

Run the repository checks from the workspace root:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm fallow audit
```

Format Markdown and TypeScript files with:

```bash
pnpm format
```

## Internal story workflow

The `/buildsip-story` skill normally runs this workflow. These commands are documented here for
development and troubleshooting; users should not need to run them manually.

Prepare filtered conversation logs. The default window is the last seven days:

```bash
buildsip prepare
buildsip prepare --hours 4
buildsip prepare --days 14
buildsip prepare --since 2026-05-23T00:00:00+03:00 --until 2026-05-24T00:00:00+03:00
```

Keep the `temp` and `until` values returned by `prepare`. After drafting story Markdown files in the
temporary folder, upload them with:

```bash
buildsip upload <temp> --until <until>
```

After a successful upload, delete the prepared logs and stories with:

```bash
buildsip cleanup <temp>
```

The `log` command is called by the installed agent hooks to record chat events. It is not intended
for manual use.

## Diagnostics

Show the authenticated BuildSip user:

```bash
buildsip whoami
```

Show the local paths used by the CLI:

```bash
buildsip paths
```
