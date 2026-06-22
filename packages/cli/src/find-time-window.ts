type TimeWindow = {
  since: Date;
  until: Date;
};

export type PrepareTempLogsOptions = {
  date?: string;
  days?: string;
  hours?: string;
  since?: string;
  until?: string;
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
      input.now.getTime() - parsePositiveNumber(input.value, input.label) * input.windowMs,
    ),
    until: input.until === undefined ? input.now : parseDateValue(input.until, "--until"),
  };
}

function findHoursWindow(options: PrepareTempLogsOptions, now: Date): TimeWindow | undefined {
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

function findDaysWindow(options: PrepareTempLogsOptions, now: Date): TimeWindow | undefined {
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

function findSinceWindow(options: PrepareTempLogsOptions, now: Date): TimeWindow | undefined {
  if (options.since === undefined) {
    return undefined;
  }

  return {
    since: parseDateValue(options.since, "--since"),
    until: options.until === undefined ? now : parseDateValue(options.until, "--until"),
  };
}

export function findTimeWindow(options: PrepareTempLogsOptions) {
  const now = new Date();
  const finders: Array<(input: PrepareTempLogsOptions, now: Date) => TimeWindow | undefined> = [
    findHoursWindow,
    findDaysWindow,
    (input) => (input.date === undefined ? undefined : parseDateWindow(input.date)),
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
