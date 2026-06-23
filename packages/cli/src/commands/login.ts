import { cancel, intro, outro, spinner } from "@clack/prompts";
import { exchangeCode, fetchUser, prepareLogin, startCallbackServer } from "@buildsip/cli-auth";
import type { Command } from "commander";
import open from "open";
import pc from "picocolors";
import { log } from "../log";

export async function login({
  progress,
}: {
  progress: ReturnType<typeof spinner>;
}): Promise<{ email: string | undefined }> {
  const { authorizationUrl, codeVerifier, state } = await prepareLogin({
    log,
  });
  const callbackServer = await startCallbackServer({ log }, state);

  progress.message(`Opening browser to authorize ${pc.bold("BuildSip CLI")}.`);

  try {
    await open(authorizationUrl);
  } catch (error) {
    log.debug(error);
    log.warn("Could not open the browser automatically.");
  }

  progress.message(`Open this URL if your browser did not launch:\n${authorizationUrl}`);

  try {
    const code = await callbackServer.waitForCode();

    progress.message("Approval received.");

    const session = await exchangeCode(
      { log },
      {
        code,
        codeVerifier,
      },
    );
    const user = await fetchUser({ log }, session);

    return { email: user.email };
  } catch (error) {
    progress.message("Login failed.");
    throw error;
  }
}

export function registerLoginCommand(program: Command) {
  program
    .command("login")
    .description("Authenticate the BuildSip CLI.")
    .action(async () => {
      const progress = spinner();
      intro(pc.bgGreenBright(pc.whiteBright(" BuildSip ")));
      progress.start("Signing in to Buildsip.");

      try {
        const { email } = await login({ progress });
        progress.stop("Approval received.");
        outro(email ? `Signed in as ${pc.bold(email)}.` : "Signed in.");
      } catch (error) {
        log.debug(error);
        progress.stop("Login failed.");
        cancel(error instanceof Error ? error.message : "Login failed.");
        process.exitCode = 1;
      }
    });
}
