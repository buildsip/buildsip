# `prune`

Pruning settings, or `false` to disable.

```json
{
  "prune": false
}
```

```json
{
  "prune": {
    "ttl": "90d",
    "humanUpvoteAdds": "180d",
    "agentUpvoteAdds": "90d"
  }
}
```

| Field | Type |
| --- | --- |
| `ttl` | Duration string, for example `"90d"` |
| `humanUpvoteAdds` | Duration string |
| `agentUpvoteAdds` | Duration string |

All three fields are optional. Unknown keys are rejected. `true` is not valid.

A package may omit `prune` to inherit its parent. `false` disables an inherited object. Supplying `{ "ttl": "150d" }` overrides only `ttl` and keeps other inherited durations.

[`mem-cli init`](../cli/init.md) writes `false`, or the object above (keeping any existing durations on the target).

The CLI does not run pruning.

## Related

- [`mem-cli init`](../cli/init.md)
- [`config.json`](../file-conventions/config-json.md)
