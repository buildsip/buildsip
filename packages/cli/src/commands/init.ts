import { join } from "node:path";
import { adapters, installGlobalHooks, type Name } from "@buildsip/hooks";
import { cancel, confirm, intro, isCancel, multiselect, outro, spinner } from "@clack/prompts";
import type { Command } from "commander";
import pc from "picocolors";
import { installSkill } from "../install-skill";
import { findPackageRoot } from "../package-root";
import { log } from "../log";
import { runCommand } from "../run-command";
import { login } from "./login";

type InitOptions = {
  verbose?: boolean;
};

function cancelInit() {
  cancel("BuildSip init cancelled.");
  process.exitCode = 1;
}

async function selectAgentNames() {
  const selected = await multiselect<Name>({
    message: "Which agents should BuildSip configure?",
    options: adapters.map((adapter) => ({
      label: adapter.label,
      value: adapter.name,
    })),
    initialValues: adapters.map((adapter) => adapter.name),
  });

  if (isCancel(selected)) {
    cancelInit();
    return undefined;
  }

  return selected;
}

export function registerInitCommand(program: Command) {
  program
    .command("init")
    .description("Install BuildSip CLI and configure agent harnesses.")
    .option("--verbose", "Print setup command output.")
    .action(async (options: InitOptions) => {
      intro(pc.bgGreenBright(pc.whiteBright(" BuildSip ")));
      const progress = spinner();

      try {
        const names = await selectAgentNames();

        if (!names) {
          return;
        }

        const installMode = process.env.BUILDSIP_INSTALL_MODE ?? "registry";

        if (installMode !== "registry" && installMode !== "link") {
          throw new Error('BUILDSIP_INSTALL_MODE must be "registry" or "link".');
        }

        if (installMode === "link") {
          progress.start("Installing local BuildSip CLI.");
          const packageRoot = findPackageRoot();
          await runCommand("pnpm", ["build"], {
            cwd: packageRoot,
            verbose: options.verbose,
          });
          progress.message(`Linking local ${pc.greenBright("buildsip")} CLI globally.`);
          await runCommand("pnpm", ["add", "-g", "."], {
            cwd: packageRoot,
            verbose: options.verbose,
          });
          progress.stop(`Installed the local ${pc.greenBright("buildsip")} CLI.`);
        } else {
          progress.start(`Installing ${pc.greenBright("buildsip")} CLI.`);
          await runCommand("npm", ["i", "-g", "buildsip@latest"], {
            verbose: options.verbose,
          });
          progress.stop(`Installed ${pc.greenBright("buildsip")} CLI.`);
        }

        progress.start("Installing global hooks.");
        await installGlobalHooks(names);
        progress.stop("Installed 2 global hooks.");

        progress.start(`Installing the ${pc.greenBright("/buildsip-story")} global skill.`);
        await installSkill({
          names,
          source:
            installMode === "link"
              ? join(findPackageRoot(), "..", "..", "skills")
              : "buildsip/buildsip",
          verbose: options.verbose,
        });

        progress.stop(`Installed the ${pc.greenBright("/buildsip-story")} global skill.`);

        const shouldLogin = await confirm({
          message: "Sign in to Buildsip?",
          initialValue: true,
        });

        if (isCancel(shouldLogin)) {
          cancelInit();
          return;
        }

        if (shouldLogin) {
          progress.start("Logging in to BuildSip.");
          const { email } = await login({ progress });
          progress.stop(email ? `Signed in as ${pc.bold(email)}.` : "Signed in.");
        }

        outro(
          `Done. Run the ${pc.greenBright("/buildsip-story")} skill in your agent to start using BuildSip.`,
        );
      } catch (error) {
        log.debug(error);
        progress.stop();
        cancel(error instanceof Error ? error.message : "BuildSip init failed.");
        process.exitCode = 1;
      }
    });
}
