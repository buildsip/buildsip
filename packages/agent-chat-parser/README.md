# @buildsip/agent-chat-parser

Read-only parsers for local AI agent conversation storage.

This package discovers native session records from supported tools and parses the visible conversation text. It returns user and assistant text plus useful session metadata, and omits reasoning, tool usage, token usage, pending tasks, summaries, and other internal state.

## API

```ts
import { listSessions, parseSession } from '@buildsip/agent-chat-parser';

const sessions = await listSessions({ source: 'codex', cwd: '/repo', limit: 10 });
const conversation = await parseSession(sessions[0]);
```

`listSessions(options?)` scans supported tool storage read-only and returns `UnifiedSession[]`.

Options:

- `source`: restrict discovery to one supported tool.
- `cwd`: restrict discovery to sessions for a working directory when the parser can resolve it.
- `limit`: cap returned sessions after newest-first sorting.

`parseSession(session)` returns:

```ts
{
  session: UnifiedSession;
  messages: Message[];
}
```

`UnifiedSession` contains:

```ts
{
  id: string;
  source: SessionSource;
  cwd: string;
  repo?: string;
  branch?: string;
  gitSha?: string;
  createdAt: Date;
  updatedAt: Date;
  originalPath: string;
  model?: string;
}
```

`Message` contains:

```ts
{
  sequence: number;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: Date;
  sourceId?: string;
  sourceParentId?: string;
}
```

All supported sources remain registered. Tool-specific parsers are exported from `src/parsers/index.ts` for lower-level use.
