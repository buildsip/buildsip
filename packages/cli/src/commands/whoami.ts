import { cancel, intro, outro } from "@clack/prompts";
import { fetchUser, auth } from "@buildsip/cli-auth";
import type { Command } from "commander";
import { log } from "../log";
import pc from "picocolors";

export function registerWhoamiCommand(program: Command) {
  program
    .command("whoami")
    .description("Show the authenticated BuildSip user.")
    .action(async () => {
      intro(pc.bgGreenBright(pc.whiteBright(" BuildSip ")));

      try {
        const { error, session } = await auth({ log });

        if (error || !session) {
          cancel(error?.message ?? "Not logged in. Run buildsip login first.");
          process.exitCode = 1;
          return;
        }

        const user = await fetchUser({ log }, session);

        if (user.email) {
          outro(`Signed in as ${pc.bold(user.email)}.`);
        }
      } catch (error) {
        log.debug(error);
        if (error instanceof Error) {
          cancel(error.message);
        }

        cancel("Could not read the current user.");
        process.exitCode = 1;
      }
    });
}
