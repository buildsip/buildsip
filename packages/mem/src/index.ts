#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cancel } from "@clack/prompts";
import { Command } from "commander";
import { init } from "./init";
import { search } from "./search";
import { upsert } from "./upsert";
import { deleteMemories } from "./delete-memories";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const program = new Command().name("mem").version(pkg.version).exitOverride();
program.configureOutput({ writeErr: () => {} });

program
  .command("init")
  .description("Initialize or reconfigure memories for the nearest package or Git root.")
  .option("--verbose", "Print setup command output.")
  .action(async (options: { verbose?: boolean }) => {
    await init({ cwd: process.cwd(), packageRoot, verbose: options.verbose });
  });

const commands = new Map<string, Command>();
for (const name of ["search", "upsert", "delete"]) {
  commands.set(
    name,
    program
      .command(name)
      .requiredOption(
        "--roots <path...>",
        "Workspace directories; repeat the flag or provide multiple paths.",
      )
      .requiredOption("--target-project <path>", "Git root or package directory to operate on."),
  );
}

commands
  .get("search")!
  .description("Search memory titles, frontmatter, directory tags, and Markdown bodies.")
  .requiredOption("--query <text>", "Nonempty search query.")
  .option(
    "--scope <path...>",
    "Repository-relative paths or globs; defaults to all project memories.",
  )
  .option("--limit <number>", "Maximum number of results.", "20")
  .option("--offset <number>", "Number of ranked results to skip.", "0")
  .action(
    async (options: {
      roots: string[];
      targetProject: string;
      query: string;
      scope?: string[];
      limit: string;
      offset: string;
    }) => {
      const result = await search({
        ...options,
        limit: Number(options.limit),
        offset: Number(options.offset),
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    },
  );

commands
  .get("upsert")!
  .description("Insert a memory, or update an existing memory using its stable id.")
  .requiredOption("--title <text>", "Memory title; also names the memory directory.")
  .option("--id <id>", "Stable memory id; generates a UUID for a new memory when omitted.")
  .option(
    "--scope <path...>",
    "Repository-relative frontmatter scopes; preserves existing scopes when omitted.",
  )
  .option("--body-file <path>", "Read Markdown from this file; omit or use - to read stdin.")
  .option(
    "--custom <json>",
    "Custom frontmatter fields as a JSON object; validated against config.",
  )
  .option("--do-not-edit", "Protect the memory from later updates.")
  .option("--no-do-not-edit", "Set doNotEdit to false on an unprotected memory.")
  .option("--do-not-delete", "Protect the memory from deletion.")
  .option("--no-do-not-delete", "Set doNotDelete to false.")
  .action(
    async (options: {
      roots: string[];
      targetProject: string;
      title: string;
      id?: string;
      scope?: string[];
      bodyFile?: string;
      custom?: string;
      doNotEdit?: boolean;
      doNotDelete?: boolean;
    }) => {
      let body: string;
      if (options.bodyFile && options.bodyFile !== "-") {
        body = await readFile(options.bodyFile, "utf8");
      } else {
        if (process.stdin.isTTY)
          throw new Error("Provide --body-file or pipe Markdown into stdin.");
        process.stdin.setEncoding("utf8");
        body = "";
        for await (const chunk of process.stdin) body += chunk;
      }
      const custom: unknown = options.custom === undefined ? {} : JSON.parse(options.custom);
      if (!custom || typeof custom !== "object" || Array.isArray(custom))
        throw new Error("--custom must be a JSON object.");
      const result = await upsert({ ...options, body, custom: custom as Record<string, unknown> });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    },
  );

commands
  .get("delete")!
  .description("Delete memories and their attachments by path, respecting doNotDelete.")
  .requiredOption(
    "--path <path...>",
    "Paths returned by search, or their memory directories; repeatable.",
  )
  .action(async (options: { roots: string[]; targetProject: string; path: string[] }) => {
    const result = await deleteMemories({ ...options, paths: options.path });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

program.action(() => program.help());

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const code = (error as { code?: string }).code;
  if (code !== "commander.helpDisplayed" && code !== "commander.version") {
    const message = error instanceof Error ? error.message : "mem failed.";
    if (process.argv[2] === "init") cancel(message);
    else process.stderr.write(`${JSON.stringify({ error: message })}\n`);
    process.exitCode = 1;
  }
}
