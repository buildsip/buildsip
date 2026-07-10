import { cancel } from "@clack/prompts";
import type { Command } from "commander";
import { addAlias, findAliases, readConfig, removeAlias, writeConfig, type Alias } from "../alias";
import { findGitProjectRoot } from "../find-project-root";
import { log } from "../log";

type ListOptions = {
  all?: boolean;
};

async function findRequiredGitProjectRoot() {
  const root = await findGitProjectRoot(process.cwd());

  if (!root) {
    throw new Error(
      "This project isn't in a git repository. Please initialize a git repository, then try again.",
    );
  }

  return root;
}

function formatAlias(item: Alias) {
  const aliases = item.aliases.length
    ? item.aliases.map((alias) => `  ${alias}`).join("\n")
    : "  (no aliases)";

  return `${item.root}\n${aliases}`;
}

function formatAliases(items: Alias[]) {
  const itemsWithAliases = items.filter((item) => item.aliases.length > 0);

  if (itemsWithAliases.length === 0) {
    return "No aliases configured.";
  }

  return itemsWithAliases.map(formatAlias).join("\n\n");
}

export function registerAliasCommand(program: Command) {
  const command = program.command("alias").description("Manage aliases.");

  command
    .command("add")
    .description("Add an old path as an alias for the current git root.")
    .argument("<path>", "Old path to include when preparing stories")
    .action(async (aliasPath: string) => {
      try {
        const root = await findRequiredGitProjectRoot();
        const config = await readConfig();
        const result = addAlias({ config, root, alias: aliasPath });

        await writeConfig(result.config);
        process.stdout.write(
          `${result.added ? "Added alias." : "Alias already exists."}\n\n${formatAlias({
            root,
            aliases: findAliases({ config: result.config, root }),
          })}\n`,
        );
      } catch (error) {
        log.debug(error);
        cancel(error instanceof Error ? error.message : "Could not add alias.");
        process.exitCode = 1;
      }
    });

  command
    .command("list")
    .description("List aliases for the current git root.")
    .option("--all", "List aliases for all roots.")
    .action(async (options: ListOptions) => {
      try {
        const config = await readConfig();

        if (options.all) {
          process.stdout.write(`${formatAliases(config.projects)}\n`);
          return;
        }

        const root = await findRequiredGitProjectRoot();
        process.stdout.write(
          `${formatAlias({
            root,
            aliases: findAliases({ config, root }),
          })}\n`,
        );
      } catch (error) {
        log.debug(error);
        cancel(error instanceof Error ? error.message : "Could not list aliases.");
        process.exitCode = 1;
      }
    });

  command
    .command("remove")
    .description("Remove an alias from the current git root.")
    .argument("<path>", "Alias path to remove")
    .action(async (aliasPath: string) => {
      try {
        const root = await findRequiredGitProjectRoot();
        const config = await readConfig();
        const result = removeAlias({ config, root, alias: aliasPath });

        if (!result.removed) {
          throw new Error(`Alias not found: ${aliasPath}`);
        }

        await writeConfig(result.config);
        process.stdout.write(
          `Removed alias.\n\n${formatAlias({
            root,
            aliases: findAliases({ config: result.config, root }),
          })}\n`,
        );
      } catch (error) {
        log.debug(error);
        cancel(error instanceof Error ? error.message : "Could not remove alias.");
        process.exitCode = 1;
      }
    });

  command.action(() => {
    command.help();
  });
}
