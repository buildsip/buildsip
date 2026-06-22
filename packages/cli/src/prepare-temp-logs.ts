import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  listSessions,
  parseSession,
  type AgentChatParserContext,
  type Message,
  type UnifiedSession,
} from "@buildsip/agent-chat-parser";
import { findProjectStore } from "./buildsip-store";
import { makeTempFolder } from "./make-temp-folder";
import { findTimeWindow, PrepareTempLogsOptions } from "./find-time-window";

export type PrepareTempLogsContext = AgentChatParserContext;

export type PrepareTempLogsResult = {
  buildsipSessionsRead: number;
  buildsipSessionsWritten: number;
  localAgentSessionsRead: number;
  localAgentSessionsWritten: number;
  logsDir: string;
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
  cwd: string[];
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function normalizeBuildsipLogLine(message: unknown): TempLogLine {
  if (typeof message !== "object" || message === null) {
    throw new Error("BuildSip log line must be an object.");
  }

  const cwd = "cwd" in message ? message.cwd : undefined;
  const role = "role" in message ? message.role : undefined;
  const content = "content" in message ? message.content : undefined;
  const timestamp = "timestamp" in message ? message.timestamp : undefined;

  if (!isStringArray(cwd)) {
    throw new Error("BuildSip log line is missing cwd.");
  }

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
    cwd,
    role,
    content,
    timestamp: date.toISOString(),
  };
}

function isLogLineInWindow(message: TempLogLine, since: Date, until: Date) {
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

function isSessionInWindow(session: UnifiedSession, since: Date, until: Date) {
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
    cwd: [session.cwd],
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

  if (!messages.some((message) => isLogLineInWindow(message, since, until))) {
    return {
      sessionsRead: 1,
      sessionsWritten: 0,
    };
  }

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

async function prepareLocalAgentSessions(
  ctx: PrepareTempLogsContext,
  input: {
    buildsipFileNames: Set<string>;
    projectRoot: string;
    since: Date;
    tempLogsDir: string;
    until: Date;
  },
) {
  let sessionsRead = 0;
  let sessionsWritten = 0;
  const writtenFileNames = new Set<string>();
  const sessions = await listSessions(ctx, { cwd: input.projectRoot });

  for (const session of sessions) {
    if (
      !isSessionInProject(session, input.projectRoot) ||
      !isSessionInWindow(session, input.since, input.until)
    ) {
      continue;
    }

    const fileName = sessionFileName(session);

    if (input.buildsipFileNames.has(fileName) || writtenFileNames.has(fileName)) {
      continue;
    }

    sessionsRead++;

    try {
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
  const projectStore = await findProjectStore();
  const logsDir = projectStore.logsDir;
  const { temp, tempDir, tempLogsDir } = await makeTempFolder();
  const { since, until } = findTimeWindow(options);

  const result = {
    logsDir,
    temp,
    tempDir,
    tempLogsDir,
    since: since.toISOString(),
    until: until.toISOString(),
  };

  let buildsipSessionsRead = 0;
  let buildsipSessionsWritten = 0;
  const fileNames = await readLogFileNames(logsDir);
  const buildsipFileNames = new Set(fileNames);

  for (const fileName of fileNames) {
    const preparedFile = await prepareLogFile({
      fileName,
      logsDir,
      since,
      tempLogsDir,
      until,
    });

    buildsipSessionsRead += preparedFile.sessionsRead;
    buildsipSessionsWritten += preparedFile.sessionsWritten;
  }

  const localAgentSessions = await prepareLocalAgentSessions(ctx, {
    buildsipFileNames,
    projectRoot: projectStore.projectRoot,
    since,
    tempLogsDir,
    until,
  });

  return {
    ...result,
    buildsipSessionsRead,
    buildsipSessionsWritten,
    localAgentSessionsRead: localAgentSessions.sessionsRead,
    localAgentSessionsWritten: localAgentSessions.sessionsWritten,
  };
}
