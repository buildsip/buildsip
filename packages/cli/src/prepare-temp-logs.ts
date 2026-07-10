import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  listSessions,
  parseSession,
  type AgentChatParserContext,
  type Message,
  type UnifiedSession,
} from "@buildsip/agent-chat-parser";
import { findAliases, readConfig } from "./alias";
import { buildSipStoreFromRoot } from "./build-sip-store";
import { findGitProjectRoot, findProjectRoot } from "./find-project-root";
import { makeTempFolder } from "./make-temp-folder";
import { findTimeWindow, PrepareTempLogsOptions } from "./find-time-window";

export type PrepareTempLogsContext = AgentChatParserContext;

export type PrepareTempLogsResult = {
  buildsipSessionsRead: number;
  buildsipSessionsWritten: number;
  localAgentSessionsRead: number;
  localAgentSessionsWritten: number;
  logsDir: string;
  projectRoot: string;
  aliases: string[];
  since: string;
  temp: string;
  tempDir: string;
  tempLogsDir: string;
  until: string;
};

type PrepareLogFileInput = {
  fileName: string;
  logsDir: string;
  since: Date;
  tempLogsDir: string;
  until: Date;
};

type PreparedLogFile = {
  sessionsRead: number;
  sessionsWritten: number;
};

type TempLogLine = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

function normalizeBuildsipLogLine(message: unknown): TempLogLine {
  if (typeof message !== "object" || message === null) {
    throw new Error("BuildSip log line must be an object.");
  }

  const role = "role" in message ? message.role : undefined;
  const content = "content" in message ? message.content : undefined;
  const timestamp = "timestamp" in message ? message.timestamp : undefined;

  if (role !== "user" && role !== "assistant") {
    throw new Error("BuildSip log line is missing role.");
  }

  if (typeof content !== "string") {
    throw new Error("BuildSip log line is missing content.");
  }

  if (typeof timestamp !== "string") {
    throw new Error("BuildSip log line is missing timestamp.");
  }

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    throw new Error("BuildSip log line has an invalid timestamp.");
  }

  return {
    role,
    content,
    timestamp: date.toISOString(),
  };
}

function isLogLineInWindow(input: { message: TempLogLine; since: Date; until: Date }) {
  const { message, since, until } = input;
  const timestamp = new Date(message.timestamp);

  return timestamp >= since && timestamp < until;
}

function sessionFileName(session: Pick<UnifiedSession, "id" | "source">) {
  return `${session.source}_${session.id}.jsonl`;
}

function isSessionInProject(session: UnifiedSession, projectRoot: string) {
  if (session.cwd.trim().length === 0) {
    return false;
  }

  const cwd = resolve(session.cwd);
  const root = resolve(projectRoot);

  return cwd === root || cwd.startsWith(`${root}${sep}`);
}

function isSessionInWindow(input: { session: UnifiedSession; since: Date; until: Date }) {
  const { session, since, until } = input;
  return session.createdAt < until && session.updatedAt >= since;
}

function normalizeLocalMessage(session: UnifiedSession, message: Message): TempLogLine | null {
  if (message.role !== "user" && message.role !== "assistant") {
    return null;
  }

  if (typeof message.content !== "string" || message.content.trim() === "") {
    return null;
  }

  const timestamp = message.timestamp ?? session.updatedAt;

  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  return {
    role: message.role,
    content: message.content,
    timestamp: timestamp.toISOString(),
  };
}

async function readLogFileNames(logsDir: string) {
  try {
    const entries = await readdir(logsDir, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => entry.name);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function prepareLogFile({
  fileName,
  logsDir,
  since,
  tempLogsDir,
  until,
}: PrepareLogFileInput): Promise<PreparedLogFile> {
  const sourcePath = join(logsDir, fileName);
  const messages = (await readFile(sourcePath, "utf8"))
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => normalizeBuildsipLogLine(JSON.parse(line) as unknown));

  if (!messages.some((message) => isLogLineInWindow({ message, since, until }))) {
    return {
      sessionsRead: 1,
      sessionsWritten: 0,
    };
  }

  // Prepared logs are read directly by the story-writing agent. Keep cwd in raw
  // hook logs for filtering/debugging, but strip it from the temp logs so alias
  // roots still read as one project and absolute paths do not leak into stories.
  await writeFile(
    join(tempLogsDir, fileName),
    `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
    "utf8",
  );

  return {
    sessionsRead: 1,
    sessionsWritten: 1,
  };
}

async function prepareBuildsipLogFiles(input: {
  projectRoots: string[];
  since: Date;
  tempLogsDir: string;
  until: Date;
}) {
  let sessionsRead = 0;
  let sessionsWritten = 0;
  const fileNames = new Set<string>();

  // Keep discovery sequential so current-root logs are registered before alias logs.
  // Current-project hook logs win over alias hook logs in case of duplicates.
  for (const projectRoot of input.projectRoots) {
    const logsDir = buildSipStoreFromRoot(projectRoot).logsDir;

    for (const fileName of await readLogFileNames(logsDir)) {
      if (fileNames.has(fileName)) {
        continue;
      }

      fileNames.add(fileName);
      const preparedFile = await prepareLogFile({
        fileName,
        logsDir,
        since: input.since,
        tempLogsDir: input.tempLogsDir,
        until: input.until,
      });

      sessionsRead += preparedFile.sessionsRead;
      sessionsWritten += preparedFile.sessionsWritten;
    }
  }

  return {
    fileNames,
    sessionsRead,
    sessionsWritten,
  };
}

/**
 * Generates prepared logs from locally stored sessions by agents like
 * Codex, Cursor, Claude Code.
 */
async function prepareLocalAgentSessions(
  ctx: PrepareTempLogsContext,
  input: {
    buildsipFileNames: Set<string>;
    projectRoots: string[];
    since: Date;
    tempLogsDir: string;
    until: Date;
  },
) {
  let sessionsRead = 0;
  let sessionsWritten = 0;
  const writtenFileNames = new Set<string>();
  const sessionsByKey = new Map<string, { rootIndex: number; session: UnifiedSession }>();

  for (const [rootIndex, projectRoot] of input.projectRoots.entries()) {
    const sessions = await listSessions(ctx, { cwd: projectRoot });

    for (const session of sessions) {
      if (
        !isSessionInProject(session, projectRoot) ||
        !isSessionInWindow({ session, since: input.since, until: input.until })
      ) {
        continue;
      }

      const key = `${session.source}:${session.id}`;
      const existing = sessionsByKey.get(key);
      const samePriority =
        existing &&
        (existing.rootIndex === rootIndex || (existing.rootIndex !== 0 && rootIndex !== 0));

      // Searching every root separately can return the same agent session more
      // than once. For example, an agent may store session "abc" under both
      // /old-app and /app after a folder rename. It can also happen if the git
      // root changes: /archive/app may be an old alias while the current root
      // is /archive/app/frontend, causing a frontend session to match both
      // searches. Treat the agent source + session id as its identity. Prefer
      // the copy found through the current root; if only aliases found it, use
      // the copy with the newest metadata.
      if (
        !existing ||
        (rootIndex === 0 && existing.rootIndex !== 0) ||
        (samePriority && session.updatedAt > existing.session.updatedAt)
      ) {
        sessionsByKey.set(key, { rootIndex, session });
      }
    }
  }

  for (const { session } of sessionsByKey.values()) {
    const fileName = sessionFileName(session);

    if (input.buildsipFileNames.has(fileName) || writtenFileNames.has(fileName)) {
      continue;
    }

    try {
      sessionsRead++;
      const parsed = await parseSession(ctx, session);
      const messages = parsed.messages
        .map((message) => normalizeLocalMessage(parsed.session, message))
        .filter((message): message is TempLogLine => message !== null);

      if (messages.length === 0) {
        continue;
      }

      await writeFile(
        join(input.tempLogsDir, fileName),
        `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
        "utf8",
      );
      sessionsWritten++;
      writtenFileNames.add(fileName);
    } catch (error) {
      ctx.log.debug("prepare: failed to import local agent session", fileName, error);
      continue;
    }
  }

  return {
    sessionsRead,
    sessionsWritten,
  };
}

export async function prepareTempLogs(
  ctx: PrepareTempLogsContext,
  options: PrepareTempLogsOptions = {},
): Promise<PrepareTempLogsResult> {
  const projectRoot = await findProjectRoot(process.cwd());
  const buildSipStore = buildSipStoreFromRoot(projectRoot);
  const logsDir = buildSipStore.logsDir;
  const { temp, tempDir, tempLogsDir } = await makeTempFolder();
  const { since, until } = findTimeWindow(options);
  const gitProjectRoot = await findGitProjectRoot(process.cwd());
  const aliases = gitProjectRoot
    ? findAliases({ config: await readConfig(), root: projectRoot })
    : [];
  const projectRoots = [projectRoot, ...aliases];

  const result = {
    logsDir,
    projectRoot,
    aliases,
    temp,
    tempDir,
    tempLogsDir,
    since: since.toISOString(),
    until: until.toISOString(),
  };

  const buildsipLogs = await prepareBuildsipLogFiles({
    projectRoots,
    since,
    tempLogsDir,
    until,
  });

  const localAgentSessions = await prepareLocalAgentSessions(ctx, {
    buildsipFileNames: buildsipLogs.fileNames,
    projectRoots,
    since,
    tempLogsDir,
    until,
  });

  return {
    ...result,
    buildsipSessionsRead: buildsipLogs.sessionsRead,
    buildsipSessionsWritten: buildsipLogs.sessionsWritten,
    localAgentSessionsRead: localAgentSessions.sessionsRead,
    localAgentSessionsWritten: localAgentSessions.sessionsWritten,
  };
}
