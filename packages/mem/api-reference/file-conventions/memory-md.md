# `memory.md`

One memory: YAML frontmatter, then Markdown.

```md
---
id: 11111111-1111-4111-8111-111111111111
title: Axios reconnect retry
---

Retry the client once after a reconnect; do not stack interceptors.
```

The file must start with a `---` delimited YAML header. Duplicate YAML keys are rejected.

[`insert`](../cli/insert.md) and [`update`](../cli/update.md) write:

```md
---
<frontmatter>
---

<body>
```

Fields are documented under [Memory](../memory/index.md).

## Related

- [`data/`](./data.md)
- [`search`](../cli/search.md)
