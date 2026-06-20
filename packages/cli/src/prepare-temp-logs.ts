import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { findProjectStore } from "./buildsip-store";
import { makeTempFolder } from "./make-temp-folder";

export type PrepareTempLogsOptions = {
  date?: string;
  days?: string;
  hours?: string;
  since?: string;
  until?: string;
};

export type PrepareTempLogsResult = {
  filesRead: number;
  filesWritten: number;
  logsDir: string;
  messagesWritten: number;
  since: string;
  temp: string;
  tempDir: string;
  tempLogsDir: string;
  until: string;
};

type TimeWindow = {
  since: Date;
  until: Date;
};

type PrepareLogFileInput = {
  fileName: string;
  logsDir: string;
  since: Date;
  tempLogsDir: string;
  until: Date;
};

type PreparedLogFile = {
  filesRead: number;
  filesWritten: number;
  messagesWritten: number;
};

function parseDateValue(value: string, label: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return date;
}

function parseDateWindow(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (match === null) {
    throw new Error(`Invalid --date value: ${value}. Use YYYY-MM-DD.`);
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const since = new Date(year, monthIndex, day, 0, 0, 0, 0);
  const until = new Date(year, monthIndex, day + 1, 0, 0, 0, 0);

  return { since, until };
}

function parsePositiveNumber(value: string, label: string) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Invalid ${label} value: ${value}`);
  }

  return number;
}

function findRelativeTimeWindow(input: {
  label: string;
  now: Date;
  until?: string;
  value: string;
  windowMs: number;
}) {
  return {
    since: new Date(
      input.now.getTime() -
        parsePositiveNumber(input.value, input.label) * input.windowMs,
    ),
    until:
      input.until === undefined
        ? input.now
        : parseDateValue(input.until, "--until"),
  };
}

function findHoursWindow(
  options: PrepareTempLogsOptions,
  now: Date,
): TimeWindow | undefined {
  if (options.hours === undefined) {
    return undefined;
  }

  return findRelativeTimeWindow({
    label: "--hours",
    now,
    until: options.until,
    value: options.hours,
    windowMs: 60 * 60 * 1000,
  });
}

function findDaysWindow(
  options: PrepareTempLogsOptions,
  now: Date,
): TimeWindow | undefined {
  if (options.days === undefined) {
    return undefined;
  }

  return findRelativeTimeWindow({
    label: "--days",
    now,
    until: options.until,
    value: options.days,
    windowMs: 24 * 60 * 60 * 1000,
  });
}

function findSinceWindow(
  options: PrepareTempLogsOptions,
  now: Date,
): TimeWindow | undefined {
  if (options.since === undefined) {
    return undefined;
  }

  return {
    since: parseDateValue(options.since, "--since"),
    until:
      options.until === undefined
        ? now
        : parseDateValue(options.until, "--until"),
  };
}

function findTimeWindow(options: PrepareTempLogsOptions) {
  const now = new Date();
  const finders: Array<
    (input: PrepareTempLogsOptions, now: Date) => TimeWindow | undefined
  > = [
    findHoursWindow,
    findDaysWindow,
    (input) =>
      input.date === undefined ? undefined : parseDateWindow(input.date),
    findSinceWindow,
  ];

  for (const findWindow of finders) {
    const window = findWindow(options, now);

    if (window !== undefined) {
      return window;
    }
  }

  if (options.until !== undefined) {
    throw new Error("--until requires --since, --hours, or --days");
  }

  return {
    since: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), // last 7 days
    until: now,
  };
}

function isMessageInWindow(message: unknown, since: Date, until: Date) {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  if (!("timestamp" in message)) {
    return false;
  }

  if (typeof message.timestamp !== "string") {
    return false;
  }

  const timestamp = new Date(message.timestamp);

  if (Number.isNaN(timestamp.getTime())) {
    return false;
  }

  return timestamp >= since && timestamp < until;
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
    .map((line) => JSON.parse(line) as unknown);

  const filteredMessages = messages.filter((message) =>
    isMessageInWindow(message, since, until),
  );

  if (filteredMessages.length === 0) {
    return {
      filesRead: 1,
      filesWritten: 0,
      messagesWritten: 0,
    };
  }

  await writeFile(
    join(tempLogsDir, fileName),
    `${filteredMessages.map((message) => JSON.stringify(message)).join("\n")}\n`,
    "utf8",
  );

  return {
    filesRead: 1,
    filesWritten: 1,
    messagesWritten: filteredMessages.length,
  };
}

export async function prepareTempLogs(
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

  let filesRead = 0;
  let filesWritten = 0;
  let messagesWritten = 0;
  const fileNames = await readLogFileNames(logsDir);

  for (const fileName of fileNames) {
    const preparedFile = await prepareLogFile({
      fileName,
      logsDir,
      since,
      tempLogsDir,
      until,
    });

    filesRead += preparedFile.filesRead;
    filesWritten += preparedFile.filesWritten;
    messagesWritten += preparedFile.messagesWritten;
  }

  return {
    ...result,
    filesRead,
    filesWritten,
    messagesWritten,
  };
}
