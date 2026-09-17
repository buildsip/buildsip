# `title`

Nonempty string. Trailing and leading whitespace is trimmed on write.

```yaml
title: Axios reconnect retry
```

The title folder is the slug of the title: NFKD, marks stripped, lowercased, runs of non-letter/non-number characters turned into `-`, leading and trailing `-` removed. It must be 1–200 bytes.

```txt
Déjà vu: cache  →  .memories/data/deja-vu-cache/memory.md
```

[`update`](../cli/update.md) always repairs the folder to this slug. A different memory already occupying that folder is rejected, including on insert.

On case-insensitive disks, a case-only mismatch of the same folder is repaired instead of treated as a collision.
