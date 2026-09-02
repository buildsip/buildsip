# BuildSip CLI

Use Codex, Cursor, or Claude to turn your AI chats into summaries you can publish.

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

Initialization installs the BuildSip CLI, configures the agent harnesses you select, adds the
BuildSip story skill.

### 2. Create your first story

Open a project in one of your agent harnesses and run the skill:

```text
/buildsip-story
```

The skill prepares your recent coding chats, drafts your work stories, and asks you to review them
before uploading anything.

## Project aliases

If you move or rename a project, add its old path as an alias so BuildSip can include conversations
recorded under that path. Run the command from the project's current Git repository:

```bash
buildsip alias add /old/project/path
```

List aliases for the current project or every project:

```bash
buildsip alias list
buildsip alias list --all
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

## Uninstall

### Remove BuildSip

Remove the BuildSip hooks and story skill, then remove the global CLI:

```bash
buildsip uninstall
npm uninstall -g buildsip
```

If the global CLI was already removed, clean up the integrations through `npx`:

```bash
npx -y buildsip@latest uninstall
```

Uninstalling preserves your Local Store at `~/.buildsip` on macOS and Linux or
`%USERPROFILE%\.buildsip` on Windows.

### Delete local data

> [!CAUTION]
> This permanently deletes your BuildSip authentication, aliases, logs, and prepared stories.

After removing BuildSip, delete the Local Store on macOS or Linux with:

```bash
rm -r ~/.buildsip
```

On Windows, delete `%USERPROFILE%\.buildsip` in File Explorer.
