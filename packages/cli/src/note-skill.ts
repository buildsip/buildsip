import type { Name } from "@buildsip/hooks";
import z from "zod";
import { runCommand } from "./run-command";

type InstallNoteSkillOptions = {
  names: Name[];
  source: string;
  verbose?: boolean;
};

const noteSkillName = "buildsip-note";

/**
 * Installs or updates the BuildSip note skill.
 */
export async function installNoteSkill(options: InstallNoteSkillOptions) {
  // `npx skills add` updates the installed skill when it succeeds.
  // Workaround until Vercel adds a --quiet flag:
  // https://github.com/vercel-labs/skills/issues/331
  // TODO: Remove this workaround when Vercel adds a --quiet flag.
  await runCommand(
    "npx",
    [
      "-y",
      "--silent",
      "skills",
      "add",
      "-g",
      options.source,
      "--skill",
      noteSkillName,
      ...options.names.flatMap((name) => ["-a", name]),
      "-y",
    ],
    { verbose: options.verbose },
  );

  // Confirm the skill is present after `npx skills add`,
  // because the skills CLI doesn't always end with process.exit(1) when an error occurs.
  const installed = z
    .array(
      z.object({
        name: z.string(),
      }),
    )
    .parse(
      JSON.parse(await runCommand("npx", ["-y", "--silent", "skills", "list", "-g", "--json"])),
    );

  if (!installed.some((skill) => skill.name === noteSkillName)) {
    throw new Error("BuildSip note skill was not installed.");
  }
}

export async function uninstallNoteSkill() {
  // Omitting --agent makes the skills CLI remove the skill from every known agent.
  await runCommand("npx", ["-y", "--silent", "skills", "remove", "-g", noteSkillName, "-y"]);
}
