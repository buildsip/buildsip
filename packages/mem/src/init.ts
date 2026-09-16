import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmdirSync } from "node:fs";
import { basename, join } from "node:path";
import { confirm, group, intro, isCancel, log, outro } from "@clack/prompts";
import { applyEdits, findNodeAtLocation, modify, parseTree, type ParseError } from "jsonc-parser";
import { gt, valid } from "semver";
import { checkPath } from "./check-path";
import { findRepo } from "./find-repo";
import { getAncestors } from "./get-ancestors";
import { readConfig } from "./read-config";
import { writeText } from "./write-text";
import type { Config } from "./memory";

export async function init({
  cwd,
  packageRoot,
  verbose = false,
}: {
  cwd: string;
  packageRoot: string;
  verbose?: boolean;
}) {
  const root = await findRepo(cwd);
  const project = getAncestors({ path: realpathSync(cwd), root }).find(
    (path) => path === root || existsSync(join(path, "package.json")),
  )!;
  const manifest = join(project, "package.json");
  const pkg = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")) : {};
  const name = typeof pkg.name === "string" && pkg.name.trim() ? pkg.name : basename(project);
  const memories = join(project, ".memories");
  const configPath = join(memories, "config.json");
  await checkPath({ path: configPath, root });
  const directory = lstatSync(memories, { throwIfNoEntry: false });
  if (directory && !directory.isDirectory()) throw new Error(`Expected a directory: ${memories}`);
  const { config, local, source } = await readConfig({ project, repo: root });

  intro("mem init");
  log.info(`Project: ${project}`);
  if (source !== undefined) {
    const update = await confirm({
      message: `${name} is already initialized. Reconfigure its settings?`,
      initialValue: false,
    });
    if (isCancel(update)) throw new Error("mem init cancelled.");
    if (!update) {
      outro(`${name} unchanged.`);
      return;
    }
  }
  const answers = await group(
    {
      availableToWorkspace: () =>
        confirm({
          message: `Make all memories in this ${project === root ? "repository" : "package"} available to the other projects in this workspace?`,
          initialValue: config.availableToWorkspace ?? false,
        }),
      prune: () => confirm({ message: "Enable pruning?", initialValue: Boolean(config.prune) }),
      labels: () =>
        confirm({ message: "Add memory tab labels to VS Code / Cursor?", initialValue: true }),
    },
    {
      onCancel: () => {
        throw new Error("mem init cancelled.");
      },
    },
  );
  if (answers.prune && !process.env.MEMORIES_DATABASE_URL) {
    log.warn(
      "MEMORIES_DATABASE_URL is not set. Pruning is enabled in config only; configure the database before using it.",
    );
  }
  const next: Config = {
    ...local,
    version: 1,
    availableToWorkspace: answers.availableToWorkspace,
    // False overrides an enabled ancestor; omitting prune would inherit it.
    prune: answers.prune
      ? {
          ttl: "90d",
          humanUpvoteAdds: "180d",
          agentUpvoteAdds: "90d",
          ...config.prune,
        }
      : false,
  };

  const settingsPath = join(root, ".vscode", "settings.json");
  let settings: string | undefined;
  let previous: string | undefined;
  if (answers.labels) {
    await checkPath({ path: settingsPath, root });
    previous = existsSync(settingsPath) ? readFileSync(settingsPath, "utf8") : undefined;
    const text = previous ?? "{}\n";
    const errors: ParseError[] = [];
    const tree = parseTree(text, errors, { allowTrailingComma: true, allowEmptyContent: true });
    if (errors.length > 0 || (tree && tree.type !== "object"))
      throw new Error(
        `Cannot update ${settingsPath}: expected a valid JSON object (comments are allowed).`,
      );
    const key = "workbench.editor.customLabels.patterns";
    const patterns = tree && findNodeAtLocation(tree, [key]);
    if (patterns && patterns.type !== "object")
      throw new Error(`Cannot update ${settingsPath}: ${key} must be an object.`);
    // Edit only this property so existing JSONC comments and other settings survive.
    settings = applyEdits(
      text,
      modify(text, [key, "**/.memories/**/memory.md"], "${dirname}/memory.md", {
        formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
      }),
    );
  }

  const cli = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const manager = cli.private ? "pnpm" : "npm";
  const globalRoot = execFileSync(manager, ["root", "-g"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  }).trim();
  const installedPath = join(globalRoot, cli.name, "package.json");
  const installed = existsSync(installedPath)
    ? JSON.parse(readFileSync(installedPath, "utf8"))
    : undefined;
  if (installed && (!valid(installed.version) || !installed.bin?.mem))
    throw new Error(
      `The global ${cli.name} package is not this CLI. Resolve that package name conflict before initializing.`,
    );
  let version: string = cli.version;
  let install = !installed;
  let latest = version;
  // Private development packages must never resolve the unrelated public npm placeholder name.
  if (!cli.private) {
    try {
      const result = JSON.parse(
        execFileSync("npm", ["view", cli.name, "version", "--json"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 5000,
          shell: process.platform === "win32",
        }),
      );
      if (valid(result) && gt(result, latest)) latest = result;
    } catch {
      log.warn("Could not check for a newer CLI release. Using the running version.");
    }
  }
  if (gt(latest, installed?.version ?? version)) {
    const upgrade = await confirm({
      message: `Upgrade ${cli.name} from ${installed?.version ?? version} to ${latest}?`,
      initialValue: true,
    });
    if (isCancel(upgrade)) throw new Error("mem init cancelled.");
    if (upgrade) {
      version = latest;
      install = true;
    }
  }
  if (install) {
    log.step(`Installing ${cli.name} ${version} globally.`);
    const args = cli.private
      ? ["add", "-g", "."]
      : ["install", "--global", `${cli.name}@${version}`];
    execFileSync(manager, args, {
      cwd: packageRoot,
      stdio: verbose ? "inherit" : "pipe",
      shell: process.platform === "win32",
    });
  }

  // Existing stores may already contain memories created by upsert; leave all of those files alone.
  if (!directory) mkdirSync(memories);
  try {
    if (settings !== undefined) {
      mkdirSync(join(root, ".vscode"), { recursive: true });
      writeText({ path: settingsPath, text: settings, previous });
    }
    writeText({ path: configPath, text: `${JSON.stringify(next, null, 2)}\n`, previous: source });
  } catch (error) {
    if (!directory) {
      // Only remove an empty directory we created; concurrent files must survive a failed init.
      try {
        rmdirSync(memories);
      } catch {
        /* The directory now contains another writer's files. */
      }
    }
    throw error;
  }
  outro(`${name} initialized.`);
}
