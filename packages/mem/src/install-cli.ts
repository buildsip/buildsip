import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { confirm, isCancel, type log } from "@clack/prompts";
import { gt, valid } from "semver";
import { getPackageManager } from "./get-package-manager";
import { NAMES } from "./names";

/**
 * Installs the global CLI through the package manager that launched this process.
 * Keeps an existing install unless a newer release is accepted, falling back to npm
 * for modern Yarn.
 * Before mem is published, installs it from the local CLI directory (`cliRoot`).
 * Once published, installs mem from the registry by name and version.
 */
export async function installCli(
  ctx: { log: Pick<typeof log, "info" | "warn" | "step"> },
  { cwd, cliRoot, verbose = false }: { cwd: string; cliRoot: string; verbose?: boolean },
) {
  const cli = JSON.parse(readFileSync(join(cliRoot, NAMES.PACKAGE_JSON), "utf8"));
  const launcher = getPackageManager();
  let packageManager = launcher.name;
  const options = {
    cwd,
    encoding: "utf8" as const,
    // These are stdin, stdout, stderr: no input, and capture both output streams as text.
    stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
    // Windows package managers commonly launch through .cmd files, which need a shell.
    shell: process.platform === "win32",
  };
  if (packageManager === "yarn") {
    const version = launcher.version;
    if (!version || !valid(version) || gt(version, "2.0.0-0")) {
      ctx.log.info(
        "This Yarn version does not support global installs. Using npm for the global CLI.",
      );
      packageManager = "npm";
    }
  }
  let globalRoot: string | undefined;
  if (packageManager === "bun") {
    // Bun reports its configured global directory in the listing, including custom bunfig paths.
    try {
      const list = execFileSync("bun", ["pm", "ls", "-g"], options);
      const path = list.split("\n")[0]?.match(/^(.*) node_modules(?: \(.*\))?$/)?.[1];
      if (!path || !isAbsolute(path)) throw new Error("Could not locate Bun's global packages.");
      globalRoot = join(path, NAMES.NODE_MODULES);
    } catch (error) {
      // A fresh Bun installation has no global package.json yet.
      const stderr = String((error as { stderr?: unknown }).stderr ?? "");
      if (!stderr.includes("No package.json was found for directory")) throw error;
    }
  } else {
    globalRoot = execFileSync(
      packageManager,
      packageManager === "yarn" ? ["global", "dir", "--silent"] : ["root", "-g"],
      options,
    ).trim();
    if (packageManager === "yarn") globalRoot = join(globalRoot, NAMES.NODE_MODULES);
  }
  const installedPath = globalRoot && join(globalRoot, cli.name, NAMES.PACKAGE_JSON);
  const installed =
    installedPath && existsSync(installedPath)
      ? JSON.parse(readFileSync(installedPath, "utf8"))
      : undefined;
  if (installed && (!valid(installed.version) || !installed.bin?.["mem-cli"]))
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
        execFileSync(
          packageManager,
          [
            packageManager === "yarn" || packageManager === "bun" ? "info" : "view",
            cli.name,
            "version",
            "--json",
          ],
          { ...options, timeout: 5000 },
        ),
      );
      const release = packageManager === "yarn" ? result.data : result;
      if (valid(release) && gt(release, latest)) latest = release;
    } catch {
      ctx.log.warn("Could not check for a newer CLI release. Using the running version.");
    }
  }
  if (gt(latest, installed?.version ?? version)) {
    const upgrade = await confirm({
      message: `Upgrade ${cli.name} from ${installed?.version ?? version} to ${latest}?`,
      initialValue: true,
    });
    if (isCancel(upgrade)) throw new Error("mem-cli init cancelled.");
    if (upgrade) {
      version = latest;
      install = true;
    }
  }
  if (install) {
    ctx.log.step(`Installing ${cli.name} ${version} globally.`);
    const spec = cli.private ? cliRoot : `${cli.name}@${version}`;
    const args =
      packageManager === "yarn"
        ? ["global", "add", spec]
        : packageManager === "npm"
          ? ["install", "--global", spec]
          : ["add", "-g", spec];
    execFileSync(packageManager, args, { ...options, stdio: verbose ? "inherit" : "pipe" });
  }
}
