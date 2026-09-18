# File-system conventions

Special files and directories mem-cli looks for on disk.

Stores are allowed at the Git root and at directories that contain `package.json`. `node_modules` and `.git` are never treated as package stores.

```txt
repo/
├── .memories/
│   ├── config.json
│   └── data/
│       └── staging-db-weekly-reset/
│           └── memory.md
└── apps/
    └── web/
        ├── package.json
        └── .memories/
            ├── config.json
            └── data/
                └── errors/
                    └── axios-reconnect-retry/
                        ├── memory.md
                        └── evidence.json
```

- [`.memories`](./memories.md)
- [`config.json`](./config-json.md)
- [`data/`](./data.md)
- [`memory.md`](./memory-md.md)
