# Memory

Language for memories shared by coding agents across repositories and packages.

## Language

**Memory**:
A piece of knowledge.
_Avoid_: knowledge.

**Repo**:
The Git working-tree root selected for the agent's current task.
_Avoid_: targetProject, target project.

**Workspace roots**:
The directories made available to the agent as its workspace. They bound which repo can be selected and where memories from other repos can be discovered.

**availableToWorkspace**:
A repo-root setting. When true, that repo's memories can be discovered from other workspace roots.
_Avoid_: shared.

**Package**:
A directory within a repo that has its own package identity and may own a memory store.

**Memory store**:
A collection of memories owned by a repo or package.

**Scope**:
A file or directory tree where a memory is relevant or a search is focused. A scope can cover one area, several explicit areas, or the whole repo; a memory belongs to the deepest package or repo containing that area.
