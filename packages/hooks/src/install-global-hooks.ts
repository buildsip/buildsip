import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { adapters, type Name } from "./adapters";

type JsonObject = Record<string, unknown>;

type InstallResult = {
  label: string;
  name: Name;
  path: string;
};

type CommandHook = {
  command: string;
  statusMessage?: string;
  timeout: number;
  type?: "command";
};

const logEvents = ["UserPromptSubmit", "Stop"] as const;
const cursorEvents = ["beforeSubmitPrompt", "afterAgentResponse"] as const;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseJson(path: string): Promise<JsonObject> {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));

    if (!isObject(value)) {
      throw new Error(`${path} must contain a JSON object.`);
    }

    return value;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }

    if (error instanceof SyntaxError) {
      throw new Error(`${path} contains invalid JSON.`);
    }

    throw error;
  }
}

async function writeJson(path: string, value: JsonObject) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isBuildSipHook(value: unknown) {
  return (
    isObject(value) &&
    typeof value.command === "string" &&
    value.command.startsWith("buildsip log --agent ")
  );
}

function createCommandHook(name: Name): CommandHook {
  return {
    type: "command",
    command: `buildsip log --agent ${name}`,
    timeout: 30,
    statusMessage: "Logging BuildSip conversation",
  };
}

function mergeOpenAiEvent(hooks: JsonObject, eventName: (typeof logEvents)[number], name: Name) {
  const groups = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
  const nextGroups: unknown[] = [];

  for (const group of groups) {
    if (!isObject(group) || !Array.isArray(group.hooks)) {
      nextGroups.push(group);
      continue;
    }

    const nextHooks = group.hooks.filter((hook) => !isBuildSipHook(hook));
    const nextGroup = { ...group, hooks: nextHooks };

    if (nextHooks.length > 0 || Object.keys(group).some((key) => key !== "hooks")) {
      nextGroups.push(nextGroup);
    }
  }

  nextGroups.push({
    hooks: [createCommandHook(name)],
  });

  hooks[eventName] = nextGroups;
}

function mergeOpenAiHooks(config: JsonObject, name: Name) {
  const hooks = isObject(config.hooks) ? { ...config.hooks } : {};

  for (const eventName of logEvents) {
    mergeOpenAiEvent(hooks, eventName, name);
  }

  return {
    ...config,
    hooks,
  };
}

function mergeCursorEvent(hooks: JsonObject, eventName: (typeof cursorEvents)[number], name: Name) {
  const eventHooks = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];

  hooks[eventName] = [
    ...eventHooks.filter((hook) => !isBuildSipHook(hook)),
    {
      command: `buildsip log --agent ${name}`,
      timeout: 30,
    },
  ];
}

function mergeCursorHooks(config: JsonObject, name: Name) {
  const hooks = isObject(config.hooks) ? { ...config.hooks } : {};

  for (const eventName of cursorEvents) {
    mergeCursorEvent(hooks, eventName, name);
  }

  return {
    ...config,
    version: typeof config.version === "number" ? config.version : 1,
    hooks,
  };
}

function mergeHooks(config: JsonObject, name: Name) {
  if (name === "cursor") {
    return mergeCursorHooks(config, name);
  }

  return mergeOpenAiHooks(config, name);
}

export async function installGlobalHooks(names: readonly Name[]) {
  const results: InstallResult[] = [];

  for (const name of names) {
    const adapter = adapters.find((item) => item.name === name);

    if (!adapter) {
      throw new Error(`Unsupported agent harness: ${name}`);
    }

    const config = await parseJson(adapter.globalPath);

    await writeJson(adapter.globalPath, mergeHooks(config, name));
    results.push({
      label: adapter.label,
      name,
      path: adapter.globalPath,
    });
  }

  return results;
}
