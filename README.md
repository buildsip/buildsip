# BuildSip CLI

Use your own agent to turn the interesting things you build in Codex, Cursor, or Claude Code into mini blog posts.

![Status: Alpha](https://img.shields.io/badge/status-alpha-orange)

> [!WARNING]
> **BuildSip is alpha software.** Releases may introduce breaking changes without notice. The
> web app supports only the latest CLI version; compatibility with earlier versions is not
> guaranteed. Keeping BuildSip up to date is strongly recommended.

BuildSip requires Node.js 22.5 or newer.

## Quickstart

### 1. Initialize BuildSip

```bash
npx buildsip init
```

Installs: the BuildSip CLI, a skill for writing stories, and agent hooks that store your conversations locally in the `.buildsip` folder.

### 2. Create your first story

Open a **project** in one of your agent harnesses and run the skill:

```text
/buildsip-story last 7 days
```

Keep the interval short to preserve story quality.

The `/buildsip-story` skill finds meaningful conversations from the selected project and turns them into stories locally. It will ask you to review them before anything is uploaded.

### 3. Login

Skip this if you've already logged in at Step 1.

Before uploading stories, make sure you login:

```bash
buildsip login
```

## Uninstall

### Remove BuildSip

```bash
buildsip uninstall # Remove the BuildSip agent hooks and story skill
npm uninstall -g buildsip
```

If the `buildsip` CLI was already removed, clean up the agent hooks and story skill through `npx`:

```bash
npx -y buildsip@latest uninstall
```

Uninstalling preserves your Local Store at `~/.buildsip` on macOS and Linux or
`%USERPROFILE%\.buildsip` on Windows.

### Delete local data

> [!CAUTION]
> This permanently deletes the `.buildsip` folder on this machine, which includes BuildSip's local copies of your chats and your aliases. Your original chats in Cursor, Claude, and Codex aren't affected.

Delete the Local Store on macOS or Linux with:

```bash
rm -r ~/.buildsip
```

On Windows, delete `%USERPROFILE%\.buildsip` in File Explorer.

## Project aliases

If you move or rename a project, add its old path as an alias so BuildSip can include conversations
recorded under that path. Run the command from the project's current Git repository:

```bash
buildsip alias add /old/project/path
```

```bash
buildsip alias list # List aliases for the current project
buildsip alias list --all # List all aliases
```

Remove an alias you no longer need:

```bash
buildsip alias remove /old/project/path
```

## Account and local data

Sign out of BuildSip:

```bash
buildsip logout
```

Show the paths BuildSip uses for authentication, configuration, logs, and temporary stories:

```bash
buildsip paths
```
