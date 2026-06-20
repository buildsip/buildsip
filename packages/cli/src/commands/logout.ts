import { intro, outro } from "@clack/prompts";
import { deleteSession, findSession } from "@buildsip/cli-auth";
import type { Command } from "commander";
import pc from "picocolors";

export function registerLogoutCommand(program: Command) {
  program.command("logout").action(() => {
    intro(pc.greenBright("BuildSip logout"));

    if (!findSession()) {
      outro("Already logged out.");
      return;
    }

    deleteSession();
    outro("Logged out.");
  });
}
