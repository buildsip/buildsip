# Memory

## `data`

Memory files must be named `memory.md`.

```bash
.memories/
└── data/                               # searchable memories
    ├── webassembly-compile-error/      # memory directory matches the memory's title
    │   └── memory.md                   # memory file
    └── opennext-cache-components/
        ├── memory.md
        ├── response.json               # unindexed attachment that the agent inspects once it retrieves the memory
        └── error.png                   # unindexed attachment
```

The names of the memory's parent directories act as searchable tags.

```bash
data/
├── errors/
│   └── webassembly-compile-error/
│       └── memory.md
├── gotchas/
│   └── cache/
│       └── opennext-cache-components/
│           └── memory.md
└── ADRs/
```

## Memory file

Frontmatter fields act as searchable tags.

```bash
---
id: 7fe24e91-4808-4f80-bc39-5d86f7a74be0          # DO NOT CHANGE
title: Axios retry duplication after reconnect
scope:
  - apps/*      # Wildcards supported!
  - services/billing
doNotDelete: false
doNotEdit: false
---

Content
```

### Fields

#### id

Required. Stable identifier for this memory. Don't change it. Used to track the memory across renames, and for upvotes when those are enabled.

#### title

Required. The memory title. Can be changed anytime.

#### doNotDelete

Optional. Defaults to `false`.

Set this to `true` if you prevent the agent from deleting this memory.

#### doNotEdit

Optional. Defaults to `false`.

Set this to `true` if you want to disallow the agent to edit it via MCP tools.

#### scope

Optional. Defaults to the parent of the `.memories` directory. Paths or globs this memory applies to.

Controls search boundaries to prevent context pollution. Read [how search works](./mcp.md#search-memories).

### Custom fields

Custom frontmatter fields act as searchable tags.

Example:

```bash
---
id: 7fe24e91-4808-4f80-bc39-5d86f7a74be0
title: Axios retry duplication after reconnect

anchors:
  - packages/api/src/websocket.ts
linear: https://linear.app/acme/issue/ACM-86/axios-reconnect-issue
retireWhen:
  condition: "Zero occurrences in Sentry for 60 days"
  links:
    - https://sentry.io/organizations/acme/issues/12345/
---

Content
```

To use custom fields, you must define [`frontmatter.custom` in `config.json`](./config.md#custom).
