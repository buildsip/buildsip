# BuildSip CLI

![Status: Alpha](https://img.shields.io/badge/status-alpha-orange)

> [!WARNING]
> **BuildSip is alpha software.** Releases may introduce breaking changes without notice. The web app supports only the latest CLI version; compatibility with earlier versions is not guaranteed. Keeping BuildSip up to date is strongly recommended.

## Set up

1. Initialize the CLI

```bash
npx buildsip init
```

2. Try it out

Go to your agent and run the Buildsip story skill:

```
/buildsip-story
```

Commands:

```bash
buildsip whoami
buildsip paths # Show local BuildSip storage paths
buildsip logout
buildsip alias add /old/project/path # Include conversations from an old project path
buildsip alias list
buildsip alias list --all
buildsip alias remove /old/project/path
buildsip prepare # Prepare logs for drafting; defaults to last 7 days
buildsip prepare --hours 4
buildsip prepare --days 14
buildsip prepare --date 2026-05-23
buildsip upload temp-abc123def456 --until 2026-06-05T12:00:00.000Z # Upload story Markdown files from the prepared temp folder. Pass `temp` and `until` from `prepare`
buildsip cleanup temp-abc123def456 # Delete the temp folder after drafting.
```

## Contributing

### Set up

1. Create a `.env` file with the following values:

```bash
BUILDSIP_INSTALL_MODE=link
OAUTH_CLIENT_ID=...
```

If you run the web app locally, add:

```bash
BUILDSIP_URL=http://localhost:3000
```

`BUILDSIP_INSTALL_MODE=link` links the local CLI package and installs the story skill from `skills`.

2. Initialize the package.

```bash
pnpm buildsip init
```

If you get this error:

> [ERROR] The configured global bin directory [dir] is not in PATH

Run:

```
pnpm setup
```

3. Don't forget always run `pnpm build` after you make changes.

To unlink `buildsip`, run:

```bash
pnpm remove -g buildsip
```
