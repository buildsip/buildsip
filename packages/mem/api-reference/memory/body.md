# `body`

Markdown after the YAML header. Insert and update require a nonempty string when `body` is supplied. Whitespace-only strings are rejected.

Trailing whitespace is stripped. The stored file ends with a single newline.

On [`update`](../cli/update.md), omit `body` to keep the current text.

```json
{
  "body": "Retry the client once after a reconnect; do not stack interceptors."
}
```
