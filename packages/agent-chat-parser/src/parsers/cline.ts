import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import * as path from "node:path";
import type {
  AgentChatParserContext,
  ParsedAgentConversation,
  UnifiedSession,
} from "../types/index";
import {
  cleanSummary,
  extractRepoFromCwd,
  homeDir,
  type MessageDraft,
  sequenceMessages,
} from "../utils/parser-helpers";

const require = createRequire(import.meta.url);

// ── Extension Configs ───────────────────────────────────────────────────────

/**
 * All Cline-family extensions share the same ui_messages.json format.
 * Each entry maps a VS Code extension ID to the source label used in UnifiedSession.
 */
const CLINE_EXTENSIONS = [
  {
    id: "saoudrizwan.claude-dev",
    source: "cline",
    customStorageSettingKeys: ["cline.customStoragePath"],
    customStorageEnvKeys: ["CLINE_STORAGE_PATH", "BUILDSIP_CLINE_STORAGE_PATH"],
  },
  {
    id: "rooveterinaryinc.roo-cline",
    source: "roo-code",
    customStorageSettingKeys: ["roo-cline.customStoragePath"],
    customStorageEnvKeys: [
      "ROO_CODE_STORAGE_PATH",
      "ROO_CLINE_STORAGE_PATH",
      "BUILDSIP_ROO_CODE_STORAGE_PATH",
    ],
  },
  {
    id: "roo-code.roo-cline",
    source: "roo-code",
    customStorageSettingKeys: [],
    customStorageEnvKeys: [],
  },
  {
    id: "kilocode.kilo-code",
    source: "kilo-code",
    customStorageSettingKeys: ["kilo-code.customStoragePath"],
    customStorageEnvKeys: ["KILO_CODE_STORAGE_PATH", "BUILDSIP_KILO_CODE_STORAGE_PATH"],
  },
] as const;

type ClineSource = (typeof CLINE_EXTENSIONS)[number]["source"];
type ClineExtension = (typeof CLINE_EXTENSIONS)[number];

const UI_MESSAGES_FILE = "ui_messages.json";
const API_CONVERSATION_HISTORY_FILE = "api_conversation_history.json";
const TASK_METADATA_FILE = "task_metadata.json";
const TASK_HISTORY_FILE = "taskHistory.json";
const HISTORY_ITEM_FILE = "history_item.json";
const HISTORY_INDEX_FILE = "_index.json";
const TASK_SIGNAL_FILES = [
  UI_MESSAGES_FILE,
  API_CONVERSATION_HISTORY_FILE,
  TASK_METADATA_FILE,
  HISTORY_ITEM_FILE,
] as const;

// ── Raw Message Shape ───────────────────────────────────────────────────────

/** Single entry in ui_messages.json */
interface ClineRawMessage {
  ts?: number;
  type: string;
  say?: string;
  ask?: string;
  text?: string;
  reasoning?: string;
  images?: string[];
  files?: string[];
  partial?: boolean;
  modelInfo?: ClineModelInfo;
}

type ConversationRole = "user" | "assistant";

interface ConversationState {
  hasSeenApiRequest: boolean;
}

interface StreamState {
  index: number;
  role: ConversationRole;
  kind: string;
}

interface ClineModelInfo {
  modelId?: string;
  providerId?: string;
  mode?: string;
}

interface ClineApiContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: unknown;
  is_error?: boolean;
}

interface ClineApiMessage {
  id?: string;
  role: ConversationRole;
  content: string | ClineApiContentBlock[];
  ts?: number;
  modelInfo?: ClineModelInfo;
}

interface ClineTaskHistoryItem {
  id: string;
  ts?: number;
  task?: string;
  cwdOnTaskInitialization?: string;
  workspace?: string;
  modelId?: string;
  mode?: string;
  status?: string;
  apiConfigName?: string;
}

interface TaskRoot {
  tasksRoot: string;
  storageRoot: string;
  source: ClineSource;
}

interface TaskEntry {
  taskDir: string;
  taskId: string;
  storageRoot: string;
  source: ClineSource;
}

type TaskHistoryMap = Map<string, ClineTaskHistoryItem>;

interface TaskFiles {
  taskDir: string;
  storageRoot: string;
  uiMessages: string;
  apiConversationHistory: string;
  taskMetadata: string;
  historyItem: string;
  taskHistoryCandidates: string[];
}

interface LoadedTaskData {
  files: TaskFiles;
  uiMessages: ClineRawMessage[];
  apiMessages: ClineApiMessage[];
  taskHistoryItem?: ClineTaskHistoryItem;
}

interface SqlitePreparedStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown | undefined;
}

interface SqliteDatabase {
  prepare(sql: string): SqlitePreparedStatement;
  close(): void;
}

interface KiloDbSchema {
  session: Set<string>;
  message: Set<string>;
  part: Set<string>;
  project: Set<string>;
  supported: boolean;
  warnings: string[];
}

interface KiloDbMessageRead {
  messages: MessageDraft[];
  model?: string;
  rowCount: number;
  firstTimestamp?: Date;
  lastTimestamp?: Date;
}

// ── Path Discovery ──────────────────────────────────────────────────────────

/**
 * Build candidate globalStorage base directories for the current platform.
 * Covers VS Code, VS Code Insiders, and Cursor on macOS / Linux / Windows.
 */
function getGlobalStorageBases(): string[] {
  const home = homeDir();
  const bases: string[] = [];

  if (process.platform === "darwin") {
    const appSupport = path.join(home, "Library", "Application Support");
    bases.push(
      path.join(appSupport, "Code", "User", "globalStorage"),
      path.join(appSupport, "Code - Insiders", "User", "globalStorage"),
      path.join(appSupport, "Cursor", "User", "globalStorage"),
      path.join(appSupport, "Windsurf", "User", "globalStorage"),
    );
  } else if (process.platform === "linux") {
    bases.push(
      path.join(home, ".config", "Code", "User", "globalStorage"),
      path.join(home, ".config", "Code - Insiders", "User", "globalStorage"),
      path.join(home, ".config", "Cursor", "User", "globalStorage"),
      path.join(home, ".config", "Windsurf", "User", "globalStorage"),
    );
  } else if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    bases.push(
      path.join(appData, "Code", "User", "globalStorage"),
      path.join(appData, "Code - Insiders", "User", "globalStorage"),
      path.join(appData, "Cursor", "User", "globalStorage"),
      path.join(appData, "Windsurf", "User", "globalStorage"),
    );
  }

  bases.push(
    path.join(home, ".vscode-server", "data", "User", "globalStorage"),
    path.join(home, ".vscode-server-insiders", "data", "User", "globalStorage"),
    path.join(home, ".cursor-server", "data", "User", "globalStorage"),
    path.join(home, ".cursor-server-insiders", "data", "User", "globalStorage"),
  );

  return uniquePaths(bases);
}

function getJetBrainsRoots(): string[] {
  const home = homeDir();

  if (process.platform === "darwin") {
    return [path.join(home, "Library", "Application Support", "JetBrains")];
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return [path.join(appData, "JetBrains")];
  }

  return [path.join(home, ".config", "JetBrains")];
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const filePath of paths) {
    const resolved = path.resolve(filePath);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    // Push the resolved (canonical, absolute) path so downstream joins,
    // existence checks, and de-dup keys stay reliable when `CLINE_DIR` or
    // other inputs were relative.
    results.push(resolved);
  }
  return results;
}

function settingsPathForGlobalStorage(base: string): string {
  return path.join(path.dirname(base), "settings.json");
}

function expandHomePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "~") return homeDir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(homeDir(), trimmed.slice(2));
  }
  return trimmed;
}

function stripJsonComments(content: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const next = content[i + 1];

    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
        result += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (!inString && char === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }

    if (!inString && char === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    result += char;

    if (escaped) {
      escaped = false;
    } else if (char === "\\" && inString) {
      escaped = true;
    } else if (char === '"') {
      inString = !inString;
    }
  }

  return result.replace(/,\s*([}\]])/gu, "$1");
}

async function readSettings(
  ctx: AgentChatParserContext,
  settingsPath: string,
): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(stripJsonComments(await fs.readFile(settingsPath, "utf8")));
    return isRecord(parsed) ? parsed : {};
  } catch (err) {
    ctx.log.debug(`cline: cannot read settings ${settingsPath}`, err);
    return {};
  }
}

async function discoverCustomStorageRoots(
  ctx: AgentChatParserContext,
  ext: ClineExtension,
  globalStorageBases: string[],
): Promise<string[]> {
  const roots: string[] = [];
  const addRoot = (value: string): void => {
    const expanded = expandHomePath(value);
    if (path.isAbsolute(expanded)) roots.push(expanded);
  };

  for (const envKey of ext.customStorageEnvKeys) {
    const value = process.env[envKey];
    if (value) addRoot(value);
  }

  for (const base of globalStorageBases) {
    const settings = await readSettings(ctx, settingsPathForGlobalStorage(base));
    for (const settingKey of ext.customStorageSettingKeys) {
      const value = readString(settings, settingKey);
      if (value) addRoot(value);
    }
  }

  return uniquePaths(roots);
}

async function findDirsNamed(
  ctx: AgentChatParserContext,
  root: string,
  dirName: string,
  maxDepth: number,
): Promise<string[]> {
  const found: string[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (err) {
      ctx.log.debug(`cline: cannot scan ${current}`, err);
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = path.join(current, entry.name);
      if (entry.name === dirName) {
        found.push(child);
        continue;
      }
      await walk(child, depth + 1);
    }
  }

  if (await pathExists(root)) await walk(root, 0);
  return found;
}

async function getJetBrainsGlobalStorageBases(ctx: AgentChatParserContext): Promise<string[]> {
  const bases: string[] = [];
  for (const root of getJetBrainsRoots()) {
    bases.push(...(await findDirsNamed(ctx, root, "globalStorage", 3)));
  }
  return uniquePaths(bases);
}

function getClineCliStorageRoots(): string[] {
  const roots: string[] = [];
  const clineDir = process.env.CLINE_DIR;
  if (clineDir) roots.push(path.join(clineDir, "data"));
  roots.push(path.join(homeDir(), ".cline", "data"));
  return uniquePaths(roots);
}

async function getTaskRoots(
  ctx: AgentChatParserContext,
  filterSource?: ClineSource,
): Promise<TaskRoot[]> {
  const roots: TaskRoot[] = [];

  if (!filterSource || filterSource === "cline") {
    for (const storageRoot of getClineCliStorageRoots()) {
      roots.push({
        tasksRoot: path.join(storageRoot, "tasks"),
        storageRoot,
        source: "cline",
      });
    }
  }

  const globalStorageBases = uniquePaths([
    ...getGlobalStorageBases(),
    ...(await getJetBrainsGlobalStorageBases(ctx)),
  ]);
  for (const base of globalStorageBases) {
    for (const ext of CLINE_EXTENSIONS) {
      if (filterSource && ext.source !== filterSource) continue;
      const storageRoot = path.join(base, ext.id);
      roots.push({
        tasksRoot: path.join(storageRoot, "tasks"),
        storageRoot,
        source: ext.source,
      });
    }
  }

  for (const ext of CLINE_EXTENSIONS) {
    if (filterSource && ext.source !== filterSource) continue;
    for (const storageRoot of await discoverCustomStorageRoots(ctx, ext, globalStorageBases)) {
      roots.push({
        tasksRoot: path.join(storageRoot, "tasks"),
        storageRoot,
        source: ext.source,
      });
    }
  }

  const seen = new Set<string>();
  return roots.filter((root) => {
    const key = `${root.source}:${path.resolve(root.tasksRoot)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function taskHasReadableData(ctx: AgentChatParserContext, taskDir: string): Promise<boolean> {
  for (const fileName of TASK_SIGNAL_FILES) {
    if (await pathExists(path.join(taskDir, fileName))) return true;
  }
  return false;
}

/**
 * Discover all task directories for a given extension across all IDE locations.
 * Returns tuples of (task-id directory path, extension source label).
 */
async function discoverTaskDirs(
  ctx: AgentChatParserContext,
  filterSource?: ClineSource,
): Promise<TaskEntry[]> {
  const taskRoots = await getTaskRoots(ctx, filterSource);
  const results: TaskEntry[] = [];

  for (const { tasksRoot, storageRoot, source } of taskRoots) {
    if (!(await pathExists(tasksRoot))) continue;

    try {
      const entries = await fs.readdir(tasksRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const taskDir = path.join(tasksRoot, entry.name);
        if (await taskHasReadableData(ctx, taskDir)) {
          results.push({ taskDir, taskId: entry.name, storageRoot, source });
        }
      }
    } catch (err) {
      ctx.log.debug(`cline: cannot read tasks dir ${tasksRoot}`, err);
    }
  }

  return results;
}

// ── Kilo Code SQLite Discovery ──────────────────────────────────────────────

function cleanEnvPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Build the ordered list of candidate Kilo data roots. The default app
 * directory upstream is the literal "kilo" name appended to xdg-basedir's
 * data root (packages/opencode/src/global/index.ts: `const app = "kilo"`),
 * so on every platform Kilo first writes under `$XDG_DATA_HOME/kilo` or
 * `~/.local/share/kilo`. The macOS / Windows fallbacks below are defensive
 * paths for non-default installs (sandboxed environments, custom XDG layouts
 * that mirror native OS conventions). Upstream Kilo does NOT itself write to
 * `~/Library/Application Support/kilo` or `%APPDATA%\kilo`; we probe them
 * only so a non-canonical install does not silently disappear from discovery.
 */
function getKiloDataRoots(): string[] {
  const home = homeDir();
  const roots: string[] = [];
  const xdgDataHome = cleanEnvPath(process.env.XDG_DATA_HOME);

  if (xdgDataHome) roots.push(path.join(xdgDataHome, "kilo"));

  // Kilo's canonical default on every platform via xdg-basedir fallback.
  roots.push(path.join(home, ".local", "share", "kilo"));

  if (process.platform === "darwin") {
    roots.push(path.join(home, "Library", "Application Support", "kilo"));
  } else if (process.platform === "win32") {
    const localAppData = cleanEnvPath(process.env.LOCALAPPDATA);
    const appData = cleanEnvPath(process.env.APPDATA);
    if (localAppData) roots.push(path.join(localAppData, "kilo"));
    if (appData) roots.push(path.join(appData, "kilo"));
  }

  return uniquePaths(roots);
}

function getKiloDbCandidatePaths(): string[] {
  const kiloDb = cleanEnvPath(process.env.KILO_DB);
  if (kiloDb) {
    if (kiloDb === ":memory:") return [];
    if (path.isAbsolute(kiloDb)) return [kiloDb];
    return uniquePaths(getKiloDataRoots().map((root) => path.join(root, kiloDb)));
  }

  return uniquePaths(getKiloDataRoots().map((root) => path.join(root, "kilo.db")));
}

async function discoverKiloDbPaths(): Promise<string[]> {
  const dbPaths: string[] = [];
  for (const dbPath of getKiloDbCandidatePaths()) {
    if (await pathExists(dbPath)) dbPaths.push(dbPath);
  }
  return dbPaths;
}

/**
 * Open Kilo's SQLite session store strictly read-only. Read-only is enforced
 * via `node:sqlite`'s `readOnly: true` flag (Node.js v22+; verified at
 * runtime by our integration test, which asserts that any write through this
 * handle throws). Read-only is non-negotiable: this parser must never mutate
 * a user's `kilo.db`.
 */
function openKiloDb(
  ctx: AgentChatParserContext,
  dbPath: string,
): { db: SqliteDatabase; close: () => void } | null {
  try {
    const sqliteModule = require("node:sqlite") as {
      DatabaseSync: new (
        database: string,
        options?: { open?: boolean; readOnly?: boolean },
      ) => SqliteDatabase;
    };
    const db = new sqliteModule.DatabaseSync(dbPath, { open: true, readOnly: true });
    return { db, close: () => db.close() };
  } catch (err) {
    ctx.log.debug("kilo-code: failed to open SQLite database", dbPath, err);
    return null;
  }
}

function tableColumns(
  ctx: AgentChatParserContext,
  db: SqliteDatabase,
  tableName: "session" | "message" | "part" | "project",
): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
    const columns = new Set<string>();
    for (const row of rows) {
      if (isRecord(row) && typeof row.name === "string") columns.add(row.name);
    }
    return columns;
  } catch (err) {
    ctx.log.debug("kilo-code: failed to inspect SQLite table", tableName, err);
    return new Set();
  }
}

function missingColumns(columns: Set<string>, required: readonly string[]): string[] {
  return required.filter((column) => !columns.has(column));
}

function inspectKiloDbSchema(ctx: AgentChatParserContext, db: SqliteDatabase): KiloDbSchema {
  const schema: KiloDbSchema = {
    session: tableColumns(ctx, db, "session"),
    message: tableColumns(ctx, db, "message"),
    part: tableColumns(ctx, db, "part"),
    project: tableColumns(ctx, db, "project"),
    supported: true,
    warnings: [],
  };

  const required: Array<
    [keyof Pick<KiloDbSchema, "session" | "message" | "part">, readonly string[]]
  > = [
    ["session", ["id"]],
    ["message", ["id", "session_id", "data"]],
    ["part", ["message_id", "data"]],
  ];

  for (const [tableName, requiredColumns] of required) {
    const columns = schema[tableName];
    if (columns.size === 0) {
      schema.warnings.push(`Kilo SQLite schema unsupported: missing "${tableName}" table.`);
      continue;
    }

    const missing = missingColumns(columns, requiredColumns);
    if (missing.length > 0) {
      schema.warnings.push(
        `Kilo SQLite schema unsupported: "${tableName}" table is missing column(s): ${missing.join(", ")}.`,
      );
    }
  }

  schema.supported = schema.warnings.length === 0;
  return schema;
}

function warnKiloDbFidelity(ctx: AgentChatParserContext, dbPath: string, warnings: string[]): void {
  if (warnings.length === 0) return;
  ctx.log.warn(
    "kilo-code: skipping SQLite database with unsupported schema",
    dbPath,
    warnings.join(" "),
  );
}

// ── Message Parsing ─────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length > 0 ? strings : undefined;
}

function readRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function normalizeModelInfo(value: unknown): ClineModelInfo | undefined {
  if (!isRecord(value)) return undefined;
  const modelId = readString(value, "modelId") ?? readString(value, "model_id");
  const providerId = readString(value, "providerId") ?? readString(value, "model_provider_id");
  const mode = readString(value, "mode");
  if (!modelId && !providerId && !mode) return undefined;
  return { modelId, providerId, mode };
}

function normalizeRawMessage(value: unknown): ClineRawMessage | null {
  if (!isRecord(value)) return null;

  const type = readString(value, "type");
  if (!type) return null;

  return {
    type,
    ts: readNumber(value, "ts"),
    say: readString(value, "say"),
    ask: readString(value, "ask"),
    text: readString(value, "text"),
    reasoning: readString(value, "reasoning"),
    images: readStringArray(value, "images"),
    files: readStringArray(value, "files"),
    partial: readBoolean(value, "partial"),
    modelInfo: normalizeModelInfo(value.modelInfo),
  };
}

function normalizeApiContentBlock(value: unknown): ClineApiContentBlock | null {
  if (!isRecord(value)) return null;
  const type = readString(value, "type");
  if (!type) return null;

  return {
    type,
    text: readString(value, "text"),
    thinking: readString(value, "thinking"),
    id: readString(value, "id"),
    name: readString(value, "name"),
    input: readRecord(value, "input"),
    content: value.content,
    is_error: readBoolean(value, "is_error"),
  };
}

function normalizeApiMessage(value: unknown): ClineApiMessage | null {
  if (!isRecord(value)) return null;
  const rawRole = readString(value, "role");
  if (rawRole !== "user" && rawRole !== "assistant") return null;

  const rawContent = value.content;
  let content: ClineApiMessage["content"] | undefined;
  if (typeof rawContent === "string") {
    content = rawContent;
  } else if (Array.isArray(rawContent)) {
    const blocks = rawContent
      .map(normalizeApiContentBlock)
      .filter((block): block is ClineApiContentBlock => block !== null);
    content = blocks;
  }

  if (content === undefined) return null;

  return {
    id: readString(value, "id"),
    role: rawRole,
    content,
    ts: readNumber(value, "ts"),
    modelInfo: normalizeModelInfo(value.modelInfo),
  };
}

function normalizeTaskHistoryItem(value: unknown): ClineTaskHistoryItem | null {
  if (!isRecord(value)) return null;
  const id = readString(value, "id");
  if (!id) return null;

  return {
    id,
    ts: readNumber(value, "ts"),
    task: readString(value, "task"),
    cwdOnTaskInitialization:
      readString(value, "cwdOnTaskInitialization") ?? readString(value, "workspace"),
    workspace: readString(value, "workspace"),
    modelId: readString(value, "modelId"),
    mode: readString(value, "mode"),
    status: readString(value, "status"),
    apiConfigName: readString(value, "apiConfigName"),
  };
}

/**
 * Companion-file read result. `warning` is set when the file existed but
 * could not be parsed or had the wrong shape. Missing files produce no warning.
 */
interface ReadResult<T> {
  value: T;
  warning?: string;
}

async function readJson(
  ctx: AgentChatParserContext,
  filePath: string,
  label: string,
): Promise<{ parsed?: unknown; warning?: string }> {
  if (!(await pathExists(filePath))) return {};
  try {
    return { parsed: JSON.parse(await fs.readFile(filePath, "utf8")) };
  } catch (err) {
    ctx.log.debug(`cline: failed to parse ${label}`, filePath, err);
    return { warning: `${label} could not be parsed (invalid JSON)` };
  }
}

/** Read and parse ui_messages.json. Returns an empty array on failure. */
async function readUiMessages(
  ctx: AgentChatParserContext,
  filePath: string,
): Promise<ReadResult<ClineRawMessage[]>> {
  const { parsed, warning } = await readJson(ctx, filePath, UI_MESSAGES_FILE);
  if (warning) return { value: [], warning };
  if (parsed === undefined) return { value: [] };
  if (!Array.isArray(parsed)) {
    return {
      value: [],
      warning: `${UI_MESSAGES_FILE} had unexpected shape (expected JSON array)`,
    };
  }
  return {
    value: parsed.map(normalizeRawMessage).filter((msg): msg is ClineRawMessage => msg !== null),
  };
}

async function readApiConversationHistory(
  ctx: AgentChatParserContext,
  filePath: string,
): Promise<ReadResult<ClineApiMessage[]>> {
  const { parsed, warning } = await readJson(ctx, filePath, API_CONVERSATION_HISTORY_FILE);
  if (warning) return { value: [], warning };
  if (parsed === undefined) return { value: [] };
  if (!Array.isArray(parsed)) {
    return {
      value: [],
      warning: `${API_CONVERSATION_HISTORY_FILE} had unexpected shape (expected JSON array)`,
    };
  }
  return {
    value: parsed
      .map(normalizeApiMessage)
      .filter((message): message is ClineApiMessage => message !== null),
  };
}

function taskHistoryArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) {
    const taskHistory = value.taskHistory ?? value.history ?? value.items ?? value.entries;
    if (Array.isArray(taskHistory)) return taskHistory;
  }
  return [];
}

interface TaskHistoryReadResult {
  map: TaskHistoryMap;
  warnings: string[];
}

async function readTaskHistoryMap(
  ctx: AgentChatParserContext,
  paths: string[],
): Promise<TaskHistoryReadResult> {
  const itemsById: TaskHistoryMap = new Map();
  const warnings: string[] = [];
  for (const filePath of paths) {
    const { parsed, warning } = await readJson(ctx, filePath, TASK_HISTORY_FILE);
    if (warning) warnings.push(warning);
    for (const item of taskHistoryArray(parsed).map(normalizeTaskHistoryItem)) {
      if (item && !itemsById.has(item.id)) itemsById.set(item.id, item);
    }
  }
  return { map: itemsById, warnings };
}

async function readTaskHistoryItemFile(
  ctx: AgentChatParserContext,
  filePath: string,
  taskId: string,
): Promise<{ item?: ClineTaskHistoryItem; warning?: string }> {
  const { parsed, warning } = await readJson(ctx, filePath, HISTORY_ITEM_FILE);
  if (warning) return { warning };
  if (parsed === undefined) return {};

  const item = normalizeTaskHistoryItem(parsed);
  if (!item) {
    return { warning: `${HISTORY_ITEM_FILE} had unexpected shape (expected JSON object)` };
  }
  return item.id === taskId ? { item } : {};
}

async function readTaskHistoryItem(
  ctx: AgentChatParserContext,
  paths: string[],
  taskId: string,
): Promise<{ item?: ClineTaskHistoryItem; warnings: string[] }> {
  const { map, warnings } = await readTaskHistoryMap(ctx, paths);
  return { item: map.get(taskId), warnings };
}

function taskHistoryCandidatesFromStorageRoot(storageRoot: string): string[] {
  return [
    path.join(storageRoot, "state", TASK_HISTORY_FILE),
    path.join(storageRoot, TASK_HISTORY_FILE),
    path.join(storageRoot, "tasks", HISTORY_INDEX_FILE),
    path.join(storageRoot, HISTORY_INDEX_FILE),
  ];
}

function taskFilesFromDir(taskDir: string, storageRoot: string): TaskFiles {
  return {
    taskDir,
    storageRoot,
    uiMessages: path.join(taskDir, UI_MESSAGES_FILE),
    apiConversationHistory: path.join(taskDir, API_CONVERSATION_HISTORY_FILE),
    taskMetadata: path.join(taskDir, TASK_METADATA_FILE),
    historyItem: path.join(taskDir, HISTORY_ITEM_FILE),
    taskHistoryCandidates: taskHistoryCandidatesFromStorageRoot(storageRoot),
  };
}

function inferTaskDirFromOriginalPath(originalPath: string): string {
  return path.extname(originalPath) === ".json" ? path.dirname(originalPath) : originalPath;
}

function inferStorageRootFromTaskDir(taskDir: string): string {
  const parent = path.dirname(taskDir);
  return path.basename(parent) === "tasks" ? path.dirname(parent) : parent;
}

async function loadTaskData(
  ctx: AgentChatParserContext,
  taskDir: string,
  storageRoot: string,
  taskId: string,
  cachedHistory?: TaskHistoryReadResult,
): Promise<LoadedTaskData> {
  const files = taskFilesFromDir(taskDir, storageRoot);
  const [uiResult, apiResult, perTaskHistoryResult, historyResult] = await Promise.all([
    readUiMessages(ctx, files.uiMessages),
    readApiConversationHistory(ctx, files.apiConversationHistory),
    readTaskHistoryItemFile(ctx, files.historyItem, taskId),
    cachedHistory
      ? Promise.resolve({ item: cachedHistory.map.get(taskId), warnings: cachedHistory.warnings })
      : readTaskHistoryItem(ctx, files.taskHistoryCandidates, taskId),
  ]);

  for (const warning of [
    uiResult.warning,
    apiResult.warning,
    perTaskHistoryResult.warning,
    ...historyResult.warnings,
  ]) {
    if (warning) ctx.log.debug("cline: companion file parse warning", warning);
  }

  return {
    files,
    uiMessages: uiResult.value,
    apiMessages: apiResult.value,
    taskHistoryItem: perTaskHistoryResult.item ?? historyResult.item,
  };
}

async function loadTaskDataFromOriginalPath(
  ctx: AgentChatParserContext,
  originalPath: string,
  taskId: string,
): Promise<LoadedTaskData> {
  const taskDir = inferTaskDirFromOriginalPath(originalPath);
  return loadTaskData(ctx, taskDir, inferStorageRootFromTaskDir(taskDir), taskId);
}

function messageText(msg: ClineRawMessage): string | undefined {
  return msg.text;
}

function apiMessageText(message: ClineApiMessage): string {
  if (typeof message.content === "string") return message.content.trim();

  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === "text" && block.text) parts.push(block.text);
  }
  return parts.join("\n").trim();
}

function buildApiConversation(messages: ClineApiMessage[]): MessageDraft[] {
  const conversation: MessageDraft[] = [];

  for (const message of messages) {
    const text =
      message.role === "user"
        ? stripEnvironmentDetails(apiMessageText(message))
        : apiMessageText(message);
    if (!text) continue;

    conversation.push({
      role: message.role,
      content: text,
      timestamp: message.ts ? new Date(message.ts) : undefined,
      sourceId: message.id,
    });
  }

  return conversation;
}

function isApiRequestMetadata(msg: ClineRawMessage): boolean {
  return msg.type === "say" && (msg.say === "api_req_started" || msg.say === "api_req_finished");
}

function parseJsonRecord(
  ctx: AgentChatParserContext,
  value: unknown,
  context: string,
): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch (err) {
    ctx.log.debug("kilo-code: failed to parse SQLite JSON", context, err);
    return null;
  }
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = readString(record, key);
    if (value?.trim()) return value;
  }
  return undefined;
}

function timestampFromValue(value: unknown): Date | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const millis = value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function roleFromMessageData(data: Record<string, unknown>): MessageDraft["role"] | null {
  const role = readString(data, "role");
  if (role === "user" || role === "assistant") return role;
  return null;
}

/** Convert a Kilo part record into visible message content. */
function extractKiloPartContent(partData: Record<string, unknown>): string {
  const type = readString(partData, "type");

  if (type === "text") {
    return firstString(partData, ["text", "content", "message"]) ?? "";
  }

  return "";
}

function selectColumns(columns: Set<string>, preferred: readonly string[]): string {
  return preferred.filter((column) => columns.has(column)).join(", ");
}

function orderBy(columns: Set<string>, preferred: string, fallback: string): string {
  if (columns.has(preferred) && columns.has(fallback)) return `${preferred} ASC, ${fallback} ASC`;
  if (columns.has(preferred)) return `${preferred} ASC`;
  if (columns.has(fallback)) return `${fallback} ASC`;
  return "rowid ASC";
}

interface KiloDbDiscoveryInfo {
  rowCount: number;
  firstUserMessage: string;
  model?: string;
  firstTimestamp?: Date;
  lastTimestamp?: Date;
}

/**
 * Discovery metadata used while listing Kilo sessions.
 *
 * Issues a single message query (no parts) to determine row count and
 * timestamps, then makes at most two follow-up part queries to recover
 * the first-user content and model (for the
 * unified session card). Avoids the N+1 message/part scan that the
 * full extraction path requires, so listing remains fast on large DBs.
 */
function readKiloDbDiscoveryInfo(
  ctx: AgentChatParserContext,
  db: SqliteDatabase,
  schema: KiloDbSchema,
  sessionId: string,
): KiloDbDiscoveryInfo {
  const messageColumns = selectColumns(schema.message, ["id", "time_created", "data"]);
  let msgRows: unknown[];
  try {
    msgRows = db
      .prepare(
        `SELECT ${messageColumns} FROM message WHERE session_id = ? ORDER BY ${orderBy(schema.message, "time_created", "id")}`,
      )
      .all(sessionId);
  } catch (err) {
    ctx.log.debug("kilo-code: failed to read message metadata for discovery", sessionId, err);
    return { rowCount: 0, firstUserMessage: "" };
  }

  let firstTimestamp: Date | undefined;
  let lastTimestamp: Date | undefined;
  let firstUserMessageId: string | undefined;
  let firstAssistantMessageId: string | undefined;
  let model: string | undefined;

  for (const msgRow of msgRows) {
    if (!isRecord(msgRow)) continue;
    const messageId = readString(msgRow, "id");
    if (!messageId) continue;

    const messageData = parseJsonRecord(ctx, msgRow.data, `message:${messageId}`);
    if (!messageData) continue;

    const role = roleFromMessageData(messageData);
    if (!role) continue;

    const timestamp = timestampFromValue(msgRow.time_created);
    if (timestamp) {
      if (!firstTimestamp || timestamp.getTime() < firstTimestamp.getTime())
        firstTimestamp = timestamp;
      if (!lastTimestamp || timestamp.getTime() > lastTimestamp.getTime())
        lastTimestamp = timestamp;
    }

    if (role === "user" && !firstUserMessageId) firstUserMessageId = messageId;
    if (role === "assistant" && !firstAssistantMessageId) {
      firstAssistantMessageId = messageId;
      if (!model) {
        model = firstString(messageData, [
          "modelID",
          "modelId",
          "model",
          "providerID",
          "providerId",
        ]);
      }
    }

    if (firstUserMessageId && firstAssistantMessageId && model) break;
  }

  const firstUserMessage = firstUserMessageId
    ? readKiloDbPartsContent(ctx, db, schema, firstUserMessageId)
    : "";

  return {
    rowCount: msgRows.length,
    firstUserMessage,
    model,
    firstTimestamp,
    lastTimestamp,
  };
}

/** Read and concatenate the text content of all parts for a single message. */
function readKiloDbPartsContent(
  ctx: AgentChatParserContext,
  db: SqliteDatabase,
  schema: KiloDbSchema,
  messageId: string,
): string {
  const partColumns = selectColumns(schema.part, ["id", "message_id", "time_created", "data"]);
  let partRows: unknown[];
  try {
    partRows = db
      .prepare(
        `SELECT ${partColumns} FROM part WHERE message_id = ? ORDER BY ${orderBy(schema.part, "time_created", "id")}`,
      )
      .all(messageId);
  } catch (err) {
    ctx.log.debug("kilo-code: failed to read part rows", messageId, err);
    return "";
  }

  const contentParts: string[] = [];
  for (const partRow of partRows) {
    if (!isRecord(partRow)) continue;
    const partData = parseJsonRecord(ctx, partRow.data, `part:${messageId}`);
    if (!partData) continue;
    const content = extractKiloPartContent(partData).trim();
    if (content) contentParts.push(content);
  }
  return contentParts.join("\n").trim();
}

function readKiloDbMessagesFromHandle(
  ctx: AgentChatParserContext,
  db: SqliteDatabase,
  schema: KiloDbSchema,
  sessionId: string,
): KiloDbMessageRead {
  const messageColumns = selectColumns(schema.message, [
    "id",
    "session_id",
    "time_created",
    "data",
  ]);
  const partColumns = selectColumns(schema.part, ["id", "message_id", "time_created", "data"]);
  const msgRows = db
    .prepare(
      `SELECT ${messageColumns} FROM message WHERE session_id = ? ORDER BY ${orderBy(schema.message, "time_created", "id")}`,
    )
    .all(sessionId);

  const messages: MessageDraft[] = [];
  let model: string | undefined;
  let firstTimestamp: Date | undefined;
  let lastTimestamp: Date | undefined;

  for (const msgRow of msgRows) {
    if (!isRecord(msgRow)) continue;
    const messageId = readString(msgRow, "id");
    if (!messageId) continue;

    const messageData = parseJsonRecord(ctx, msgRow.data, `message:${messageId}`);
    if (!messageData) continue;

    const role = roleFromMessageData(messageData);
    if (!role) continue;

    const timestamp = timestampFromValue(msgRow.time_created);
    if (timestamp) {
      if (!firstTimestamp || timestamp.getTime() < firstTimestamp.getTime())
        firstTimestamp = timestamp;
      if (!lastTimestamp || timestamp.getTime() > lastTimestamp.getTime())
        lastTimestamp = timestamp;
    }

    if (role === "assistant" && !model) {
      model =
        firstString(messageData, ["modelID", "modelId", "model", "providerID", "providerId"]) ??
        undefined;
    }

    const partRows = db
      .prepare(
        `SELECT ${partColumns} FROM part WHERE message_id = ? ORDER BY ${orderBy(schema.part, "time_created", "id")}`,
      )
      .all(messageId);

    const contentParts: string[] = [];
    for (const partRow of partRows) {
      if (!isRecord(partRow)) continue;
      const partData = parseJsonRecord(ctx, partRow.data, `part:${messageId}`);
      if (!partData) continue;

      const content = extractKiloPartContent(partData).trim();
      if (content) contentParts.push(content);
    }

    const content = contentParts.join("\n").trim();
    if (content) messages.push({ role, content, timestamp, sourceId: messageId });
  }

  return { messages, model, rowCount: msgRows.length, firstTimestamp, lastTimestamp };
}

function getProjectWorktree(
  ctx: AgentChatParserContext,
  db: SqliteDatabase,
  schema: KiloDbSchema,
  projectId: string | undefined,
): string {
  if (!projectId || !schema.project.has("id") || !schema.project.has("worktree")) return "";
  try {
    const row = db.prepare("SELECT worktree FROM project WHERE id = ?").get(projectId);
    return isRecord(row) ? (readString(row, "worktree") ?? "") : "";
  } catch (err) {
    ctx.log.debug("kilo-code: failed to read SQLite project row", projectId, err);
    return "";
  }
}

/**
 * Determine conversation role from a raw Cline message.
 * Returns null for messages that aren't conversation turns (metadata, api events).
 */
function classifyRole(msg: ClineRawMessage, state: ConversationState): ConversationRole | null {
  if (msg.type === "ask") {
    switch (msg.ask) {
      case "followup":
      case "plan_mode_respond":
      case "act_mode_respond":
      case "completion_result":
      case "resume_task":
      case "resume_completed_task":
      case "mistake_limit_reached":
      case "api_req_failed":
      case "new_task":
      case "condense":
      case "summarize_task":
      case "report_bug":
        return "assistant";

      default:
        return null;
    }
  }

  if (msg.type !== "say") return null;

  switch (msg.say) {
    case "task":
    case "user_feedback":
    case "user_feedback_diff":
      return "user";

    case "text":
      // Roo Code stores the initial user task as the first text message.
      // Once an API request exists, text messages are assistant output, including
      // partial:false finalizations of prior streaming assistant chunks.
      return state.hasSeenApiRequest || msg.partial !== undefined ? "assistant" : "user";

    case "completion_result":
      return "assistant";

    default:
      // api_req_started, api_req_finished, and other event types → not conversation
      return null;
  }
}

/**
 * Extract the first real user message from a set of raw messages.
 * Used during discovery, where we may scan thousands of
 * messages but only need the first user hit. Iterates raw messages directly
 * with the same role classification as `buildConversation`, avoiding the
 * full conversation rebuild for large sessions.
 */
function extractFirstUserMessage(messages: ClineRawMessage[]): string {
  const state: ConversationState = { hasSeenApiRequest: false };
  for (const msg of messages) {
    const role = classifyRole(msg, state);
    if (isApiRequestMetadata(msg)) state.hasSeenApiRequest = true;
    if (role !== "user") continue;
    const content = messageText(msg);
    if (!content) continue;
    const text = content.trim();
    if (text) return text;
  }
  return "";
}

/**
 * Build conversation messages from raw Cline events.
 * Deduplicates consecutive assistant streaming chunks (keeps last = most complete).
 */
function buildConversation(messages: ClineRawMessage[]): MessageDraft[] {
  const result: MessageDraft[] = [];
  const state: ConversationState = { hasSeenApiRequest: false };
  let streamState: StreamState | undefined;

  for (const msg of messages) {
    const role = classifyRole(msg, state);
    if (isApiRequestMetadata(msg)) state.hasSeenApiRequest = true;
    if (!role) continue;

    const content = messageText(msg);
    if (!content) continue;

    const text = content.trim();
    if (!text) continue;

    const ts = msg.ts ? new Date(msg.ts) : undefined;
    const kind = `${msg.type}:${msg.type === "ask" ? msg.ask : msg.say}`;
    const canReplaceStream =
      role === "assistant" &&
      streamState?.index === result.length - 1 &&
      streamState.role === role &&
      streamState.kind === kind;

    // Consecutive partial updates represent the same assistant message evolving
    // over time. Keep only the latest visible state, including partial:false
    // finalizations of the same message.
    if (canReplaceStream && (msg.partial === true || msg.partial === false)) {
      result[result.length - 1] = { role, content: text, timestamp: ts };
    } else {
      result.push({ role, content: text, timestamp: ts });
    }

    streamState =
      role === "assistant" && msg.partial === true
        ? { index: result.length - 1, role, kind }
        : msg.partial === false
          ? undefined
          : streamState;
  }

  return result;
}

function extractFirstApiUserMessage(messages: ClineApiMessage[]): string {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = apiMessageText(message);
    if (text) return stripEnvironmentDetails(text);
  }
  return "";
}

function stripEnvironmentDetails(text: string): string {
  return text.replace(/<environment_details>[\s\S]*?<\/environment_details>/giu, "").trim();
}

function extractModelFromApiHistory(messages: ClineApiMessage[]): string | undefined {
  let model: string | undefined;
  for (const message of messages) {
    if (message.modelInfo?.modelId) model = message.modelInfo.modelId;
  }
  return model;
}

function extractModelFromUiMessages(messages: ClineRawMessage[]): string | undefined {
  let model: string | undefined;
  for (const message of messages) {
    if (message.modelInfo?.modelId) model = message.modelInfo.modelId;
  }
  return model;
}

/**
 * Resolve the active model id for a task.
 *
 * Precedence (highest first):
 *   1. `taskHistory.json` `modelId` — Cline updates this index as the task
 *      progresses; the value reflects the model at last activity.
 *   2. `api_conversation_history.json` `modelInfo.modelId` — observed model
 *      on the most recent API turn. Cline persists this on every assistant
 *      message but it can drift if the user switches mid-task.
 *   3. `ui_messages.json` `modelInfo.modelId` — same observation surface as
 *      (2) but in UI form. Used last because it can include UI-only state
 *      that wasn't actually committed to the API conversation.
 */
function resolveModel(data: LoadedTaskData): string | undefined {
  return (
    data.taskHistoryItem?.modelId ??
    extractModelFromApiHistory(data.apiMessages) ??
    extractModelFromUiMessages(data.uiMessages)
  );
}

function looksLikePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("~/") || /^[A-Za-z]:[\\/]/u.test(value);
}

const CWD_KEYS = [
  "cwd",
  "cwdOnTaskInitialization",
  "currentWorkingDirectory",
  "workingDirectory",
  "workspacePath",
  "rootPath",
  "projectRoot",
];

/**
 * Search a JSON value for a working-directory hint without false positives.
 *
 * To avoid mis-classifying arbitrary paths embedded in conversation text
 * (e.g. `/usr/bin/node`) as the cwd, this only accepts path-like strings
 * when they appear:
 *   - directly under a known cwd-bearing key, or
 *   - inside a string that contains an explicit `Current Working Directory ...`
 *     / `cwd: ...` marker recognized by `extractCwdFromText`.
 *
 * Bare path-like strings (or strings nested in unrelated objects/arrays) are
 * treated as untrusted and not returned.
 */
function findCwdInValue(value: unknown, depth = 0): string | undefined {
  if (depth > 4) return undefined;

  if (typeof value === "string") {
    // Only trust strings that carry an explicit "cwd: ..." / "Current Working
    // Directory ..." marker. A bare path-like string is not enough.
    return extractCwdFromText(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const cwd = findCwdInValue(item, depth + 1);
      if (cwd) return cwd;
    }
    return undefined;
  }

  if (!isRecord(value)) return undefined;

  // Strongest signal: a known cwd key with a path-like string value.
  for (const key of CWD_KEYS) {
    const raw = readString(value, key);
    if (raw && looksLikePath(raw)) return raw;
  }

  // Fall back to scanning nested values for marker-bearing strings or nested
  // cwd keys. Any path-like leaf strings are still rejected by the typeof
  // 'string' branch above unless they include an explicit marker.
  for (const nested of Object.values(value)) {
    const cwd = findCwdInValue(nested, depth + 1);
    if (cwd) return cwd;
  }

  return undefined;
}

function extractCwdFromUiApiEvents(
  ctx: AgentChatParserContext,
  messages: ClineRawMessage[],
): string | undefined {
  for (const message of messages) {
    if (!isApiRequestMetadata(message) || !message.text) continue;
    try {
      const parsed: unknown = JSON.parse(message.text);
      const cwd = findCwdInValue(parsed);
      if (cwd) return cwd;
    } catch (err) {
      ctx.log.debug("cline: skipping malformed API request metadata while extracting cwd", err);
    }
  }
  return undefined;
}

function extractCwdFromText(text: string): string | undefined {
  const patterns = [
    /Current Working Directory\s*\(([^)]+)\)/iu,
    /Current Working Directory\s*:\s*([^\n\r]+)/iu,
    // Stop at whitespace so `cwd: /path some-other-text` does not capture
    // trailing words. Cwd values written in Cline metadata are single words.
    /\bcwd\s*[:=]\s*(\S+)/iu,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const cwd = match?.[1]?.trim();
    if (cwd && looksLikePath(cwd)) return cwd;
  }
  return undefined;
}

function extractCwdFromApiHistory(messages: ClineApiMessage[]): string | undefined {
  for (const message of messages) {
    const cwd = extractCwdFromText(apiMessageText(message));
    if (cwd) return cwd;
  }
  return undefined;
}

/**
 * Normalize a working directory to POSIX separators so downstream helpers
 * like `extractRepoFromCwd` (which splits on `/`) handle Windows paths
 * (`C:\Users\me\repo`) correctly.
 */
function normalizeCwd(value: string): string {
  return value.replace(/\\/g, "/");
}

function resolveCwd(ctx: AgentChatParserContext, data: LoadedTaskData): string {
  const raw =
    data.taskHistoryItem?.cwdOnTaskInitialization ??
    extractCwdFromUiApiEvents(ctx, data.uiMessages) ??
    extractCwdFromApiHistory(data.apiMessages) ??
    "";
  return raw ? normalizeCwd(raw) : "";
}

async function existingCompanionStats(
  ctx: AgentChatParserContext,
  files: TaskFiles,
): Promise<Array<{ filePath: string; size: number; birthtime: Date; mtime: Date }>> {
  const stats: Array<{ filePath: string; size: number; birthtime: Date; mtime: Date }> = [];
  for (const filePath of [
    files.uiMessages,
    files.apiConversationHistory,
    files.taskMetadata,
    files.historyItem,
  ]) {
    if (!(await pathExists(filePath))) continue;
    try {
      const fileStats = await fs.stat(filePath);
      stats.push({
        filePath,
        size: fileStats.size,
        birthtime: fileStats.birthtime,
        mtime: fileStats.mtime,
      });
    } catch (err) {
      ctx.log.debug(`cline: cannot stat companion file ${filePath}`, err);
    }
  }
  return stats;
}

function messageTimestamps(data: LoadedTaskData): number[] {
  const values: number[] = [];
  for (const message of data.uiMessages) {
    if (message.ts !== undefined) values.push(message.ts);
  }
  for (const message of data.apiMessages) {
    if (message.ts !== undefined) values.push(message.ts);
  }
  if (data.taskHistoryItem?.ts !== undefined) values.push(data.taskHistoryItem.ts);
  return values;
}

// ── Session Parsing (shared) ────────────────────────────────────────────────

/**
 * Discover and parse sessions for all Cline-family extensions, optionally
 * filtering to a single source variant.
 */
async function parseSessionsForSource(
  ctx: AgentChatParserContext,
  filterSource?: ClineSource,
): Promise<UnifiedSession[]> {
  const taskEntries = await discoverTaskDirs(ctx, filterSource);
  // Per-call cache. Shared across sessions under the same `storageRoot` so
  // `taskHistory.json` is read once per discovery pass; new calls always
  // re-read so live edits to taskHistory.json take effect immediately.
  const taskHistoryCache = new Map<string, Promise<TaskHistoryReadResult>>();
  const sessions: UnifiedSession[] = [];

  for (const { taskDir, taskId, storageRoot, source } of taskEntries) {
    try {
      const storageRootKey = path.resolve(storageRoot);
      let cachedHistory = taskHistoryCache.get(storageRootKey);
      if (!cachedHistory) {
        cachedHistory = readTaskHistoryMap(ctx, taskHistoryCandidatesFromStorageRoot(storageRoot));
        taskHistoryCache.set(storageRootKey, cachedHistory);
      }

      const data = await loadTaskData(ctx, taskDir, storageRoot, taskId, await cachedHistory);
      if (data.uiMessages.length === 0 && data.apiMessages.length === 0 && !data.taskHistoryItem)
        continue;

      const firstUserMsg =
        extractFirstUserMessage(data.uiMessages) ||
        extractFirstApiUserMessage(data.apiMessages) ||
        data.taskHistoryItem?.task ||
        "";
      if (!cleanSummary(firstUserMsg)) continue; // Skip sessions with no real user message

      const stats = await existingCompanionStats(ctx, data.files);
      if (stats.length === 0) continue;

      // Derive timestamps: prefer message/history timestamps, fall back to file stats.
      const timestamps = messageTimestamps(data);
      const createdAt =
        timestamps.length > 0
          ? new Date(Math.min(...timestamps))
          : new Date(Math.min(...stats.map((stat) => stat.birthtime.getTime())));
      const updatedAt =
        timestamps.length > 0
          ? new Date(Math.max(...timestamps))
          : new Date(Math.max(...stats.map((stat) => stat.mtime.getTime())));
      const cwd = resolveCwd(ctx, data);
      const model = resolveModel(data);

      sessions.push({
        id: taskId,
        source,
        cwd,
        ...(cwd ? { repo: extractRepoFromCwd(cwd) } : {}),
        ...(model ? { model } : {}),
        createdAt,
        updatedAt,
        originalPath: stats[0]!.filePath,
      });
    } catch (err) {
      ctx.log.debug(`cline: skipping unparseable task ${taskId}`, err);
    }
  }

  return sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

async function parseKiloDbSessions(ctx: AgentChatParserContext): Promise<UnifiedSession[]> {
  const sessionsById = new Map<string, UnifiedSession>();

  for (const dbPath of await discoverKiloDbPaths()) {
    const handle = openKiloDb(ctx, dbPath);
    if (!handle) continue;

    const { db, close } = handle;
    try {
      const schema = inspectKiloDbSchema(ctx, db);
      if (!schema.supported) {
        warnKiloDbFidelity(ctx, dbPath, schema.warnings);
        continue;
      }

      const dbStats = await fs.stat(dbPath);
      const sessionColumns = selectColumns(schema.session, [
        "id",
        "project_id",
        "slug",
        "directory",
        "title",
        "version",
        "time_created",
        "time_updated",
      ]);
      const sortColumn = schema.session.has("time_updated") ? "time_updated" : "id";
      const rows = db
        .prepare(`SELECT ${sessionColumns} FROM session ORDER BY ${sortColumn} DESC`)
        .all();

      for (const row of rows) {
        if (!isRecord(row)) continue;
        const id = readString(row, "id");
        if (!id) continue;

        const discoveryInfo = readKiloDbDiscoveryInfo(ctx, db, schema, id);
        if (discoveryInfo.rowCount === 0) continue;

        const projectId = readString(row, "project_id");
        const cwd = readString(row, "directory") || getProjectWorktree(ctx, db, schema, projectId);
        const createdAt =
          timestampFromValue(row.time_created) ?? discoveryInfo.firstTimestamp ?? dbStats.birthtime;
        const updatedAt =
          timestampFromValue(row.time_updated) ?? discoveryInfo.lastTimestamp ?? dbStats.mtime;

        const session: UnifiedSession = {
          id,
          source: "kilo-code",
          cwd,
          repo: extractRepoFromCwd(cwd),
          createdAt,
          updatedAt,
          originalPath: dbPath,
          model: discoveryInfo.model,
        };

        const existing = sessionsById.get(id);
        if (!existing || existing.updatedAt.getTime() < session.updatedAt.getTime()) {
          sessionsById.set(id, session);
        }
      }
    } catch (err) {
      ctx.log.debug("kilo-code: failed to parse SQLite sessions", dbPath, err);
    } finally {
      close();
    }
  }

  return Array.from(sessionsById.values()).sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
}

async function parseKiloSessionsAll(ctx: AgentChatParserContext): Promise<UnifiedSession[]> {
  const sessionsById = new Map<string, UnifiedSession>();
  for (const session of await parseKiloDbSessions(ctx)) {
    sessionsById.set(session.id, session);
  }
  for (const session of await parseSessionsForSource(ctx, "kilo-code")) {
    const existing = sessionsById.get(session.id);
    if (!existing || existing.updatedAt.getTime() < session.updatedAt.getTime()) {
      sessionsById.set(session.id, session);
    }
  }
  return Array.from(sessionsById.values()).sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
}

// ── Context Extraction (shared) ─────────────────────────────────────────────

/** Extract visible messages for all three Cline-family variants. */
async function parseMessagesShared(
  ctx: AgentChatParserContext,
  session: UnifiedSession,
): Promise<ParsedAgentConversation> {
  const data = await loadTaskDataFromOriginalPath(ctx, session.originalPath, session.id);

  const uiConversation = buildConversation(data.uiMessages);
  const apiConversation = buildApiConversation(data.apiMessages);
  const allConversation = uiConversation.length > 0 ? uiConversation : apiConversation;
  const model = resolveModel(data);
  const cwd = resolveCwd(ctx, data) || session.cwd;
  const sessionWithMetadata: UnifiedSession = {
    ...session,
    ...(cwd ? { cwd, repo: session.repo || extractRepoFromCwd(cwd) } : {}),
    ...(model ? { model } : {}),
  };

  return {
    session: sessionWithMetadata,
    messages: sequenceMessages(allConversation),
  };
}

function isTaskCompanionPath(filePath: string): boolean {
  return path.basename(path.dirname(path.dirname(filePath))) === "tasks";
}

function isKiloDbSession(session: UnifiedSession): boolean {
  return session.source === "kilo-code" && !isTaskCompanionPath(session.originalPath);
}

function emptyKiloDbConversation(session: UnifiedSession): ParsedAgentConversation {
  return { session, messages: [] };
}

async function extractKiloDbContext(
  ctx: AgentChatParserContext,
  session: UnifiedSession,
): Promise<ParsedAgentConversation> {
  const handle = openKiloDb(ctx, session.originalPath);
  if (!handle) {
    return emptyKiloDbConversation(session);
  }

  const { db, close } = handle;
  try {
    const schema = inspectKiloDbSchema(ctx, db);
    if (!schema.supported) {
      warnKiloDbFidelity(ctx, session.originalPath, schema.warnings);
      return emptyKiloDbConversation(session);
    }

    const messageRead = readKiloDbMessagesFromHandle(ctx, db, schema, session.id);
    const enrichedSession = messageRead.model ? { ...session, model: messageRead.model } : session;

    return {
      session: enrichedSession,
      messages: sequenceMessages(messageRead.messages),
    };
  } catch (err) {
    ctx.log.debug(
      "kilo-code: failed to extract SQLite context",
      session.originalPath,
      session.id,
      err,
    );
    return emptyKiloDbConversation(session);
  } finally {
    close();
  }
}

// ── Public API: Cline ───────────────────────────────────────────────────────

/** Discover sessions for Cline only */
export async function parseClineSessions(ctx: AgentChatParserContext): Promise<UnifiedSession[]> {
  return parseSessionsForSource(ctx, "cline");
}

/** Extract visible messages from a Cline session */
export async function extractClineContext(
  ctx: AgentChatParserContext,
  session: UnifiedSession,
): Promise<ParsedAgentConversation> {
  return parseMessagesShared(ctx, session);
}

// ── Public API: Roo Code ────────────────────────────────────────────────────

/** Discover sessions for Roo Code only */
export async function parseRooCodeSessions(ctx: AgentChatParserContext): Promise<UnifiedSession[]> {
  return parseSessionsForSource(ctx, "roo-code");
}

/** Extract visible messages from a Roo Code session */
export async function extractRooCodeContext(
  ctx: AgentChatParserContext,
  session: UnifiedSession,
): Promise<ParsedAgentConversation> {
  return parseMessagesShared(ctx, session);
}

// ── Public API: Kilo Code ───────────────────────────────────────────────────

/** Discover sessions for Kilo Code only */
export async function parseKiloCodeSessions(
  ctx: AgentChatParserContext,
): Promise<UnifiedSession[]> {
  return parseKiloSessionsAll(ctx);
}

/** Extract visible messages from a Kilo Code session */
export async function extractKiloCodeContext(
  ctx: AgentChatParserContext,
  session: UnifiedSession,
): Promise<ParsedAgentConversation> {
  if (isKiloDbSession(session)) return extractKiloDbContext(ctx, session);
  return parseMessagesShared(ctx, session);
}
