import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { BetterFetchError, ValidationError, betterFetch } from "@better-fetch/fetch";
import { cancel, intro, outro, spinner } from "@clack/prompts";
import { auth } from "@buildsip/cli-auth";
import type { Command } from "commander";
import pc from "picocolors";
import z from "zod";
import { config } from "../constants";
import { log } from "../log";
import { resolveTempFolder } from "../resolve-temp-folder";

type UploadOptions = {
  until?: string;
};

async function findMarkdownPaths(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(directory, entry.name))
    .sort();
}

async function readStoryForm(storyPaths: string[], until: string) {
  const body = new FormData();
  body.set("until", until);

  for (const storyPath of storyPaths) {
    body.append(
      "stories",
      new Blob([await readFile(storyPath)], {
        type: "text/markdown; charset=utf-8",
      }),
      basename(storyPath),
    );
  }

  return body;
}

export function registerUploadCommand(program: Command) {
  program
    .command("upload")
    .description("Upload story markdown files from a temp folder.")
    .argument("<temp>", "Temp folder name from prepare")
    .option("--until <iso>", "Story work window end timestamp")
    .action(async (temp: string, options: UploadOptions) => {
      intro(pc.greenBright("BuildSip upload"));
      const s = spinner();
      s.start("Preparing upload.");

      try {
        const { error: authError, session } = await auth({ log });

        if (authError || !session) {
          throw authError ?? new Error("Not logged in. Run buildsip login first.");
        }

        const { tempDir } = await resolveTempFolder(temp);
        const storyPaths = await findMarkdownPaths(tempDir);

        if (!options.until) {
          throw new Error("Upload requires --until from the buildsip prepare result.");
        }

        if (storyPaths.length === 0) {
          throw new Error("No story markdown files found.");
        }

        const body = await readStoryForm(storyPaths, options.until);

        s.message("Uploading draft.");
        const { data, error } = await betterFetch("/api/drafts", {
          baseURL: config.apiBaseUrl,
          body,
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
          method: "POST",
          output: z.object({
            draftLink: z.url(),
          }),
        });

        if (error) {
          if (error instanceof BetterFetchError) {
            const uploadError = z
              .object({
                error: z.string(),
              })
              .safeParse(error.error);

            throw new Error(
              uploadError.success
                ? uploadError.data.error
                : `Draft upload failed with status ${error.status}.`,
            );
          }

          if (error instanceof ValidationError) {
            throw new Error("BuildSip returned an invalid upload response.");
          }

          throw error;
        }

        s.stop("Draft uploaded.");
        outro(data.draftLink);
      } catch (error) {
        s.stop("Upload failed.");
        log.debug(error);
        cancel(error instanceof Error ? error.message : "Upload failed.");
        process.exitCode = 1;
      }
    });
}
