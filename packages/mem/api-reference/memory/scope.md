# `scope`

Repository-relative file or directory paths this memory applies to. Directories include descendants. `*` is the whole repo. `.` is treated like `*` when placing a memory.

```yaml
scope:
  - apps/web/auth
  - apps/web/src/constants.ts
```

When present, `scope` is an array with at least one path, including in stored YAML. A single path still uses an array. It is required on [`insert`](../cli/insert.md). On [`update`](../cli/update.md), supplying it recomputes placement; omitting it leaves the current store.

## Paths

Each entry is a nonempty repo-relative path. `/` is stored on every OS. `./`, repeated slashes, and a trailing slash are normalized. Absolute paths, `..`, `!` exclusions, NUL, and globs (`*`, `?` except the whole-repo marker `*`) are rejected. Brackets and parentheses stay literal, so routes like `(auth)/[id]` work.

A parent path already covers its children; redundant children are dropped.

## Placement

The store is the deepest directory that contains every scoped path and has `package.json`, falling back to the Git root. Sibling packages such as `apps/web` and `apps/api` therefore land at the repo. A non-package folder such as `apps` also lands at the repo rather than in one child.

If the store location already expresses the whole scope (`["apps/web"]` in `apps/web`, or `["*"]` at the repo), the saved YAML omits `scope`. Search then treats the owning package, or `.` at the repo, as the implied scope.

Scopes must stay inside `--repo`. Nested Git repositories and symlinked scope paths are rejected. The scoped files do not need to exist yet.

## Search

See [`search`](../cli/search.md) for how `--scope` filters memories.

## Examples

```json
{ "scope": ["apps/web"] }
```

Store: `apps/web/.memories`. Stored YAML has no `scope` key.

```json
{ "scope": ["apps/web", "apps/api"] }
```

Store: repo `.memories`. Stored YAML keeps both paths.

```json
{ "scope": ["*"] }
```

Store: repo `.memories`. Stored YAML has no `scope` key.
