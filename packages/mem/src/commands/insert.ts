import type { Command } from "commander";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { insertSchema } from "../insert-schema";
import { parseValue } from "../parse-value";
import { placeMemory } from "../place-memory";
import { readJsonInput } from "../read-json-input";
import { resolveRepo } from "../resolve-repo";
import { saveMemory } from "../save-memory";

/** Creates one memory with a generated ID and returns its saved directory path in an array. */
export async function insert({
  roots,
  repo,
  ...value
}: z.infer<typeof insertSchema> & {
  roots: string[];
  repo: string;
}) {
  // Direct callers receive the same field errors as CLI callers.
  const { body, frontmatter: input } = parseValue({
    schema: insertSchema,
    value,
    label: "insert input",
  });
  const workspace = await resolveRepo({ roots, repo });
  const { project, scope } = await placeMemory({ repo: workspace.repo, scope: input.scope });
  const frontmatter = { ...input, id: randomUUID(), title: input.title.trim(), scope };
  // A missing scope in the stored file means the owning store supplies the whole scope.
  if (scope === undefined) delete frontmatter.scope;
  return saveMemory({
    repo: workspace.repo,
    project,
    frontmatter,
    body: `${body.replace(/\s*$/, "")}\n`,
  });
}

/** Registers creation separately from partial updates, with JSON from a file or stdin. */
export function registerInsertCommand({ program }: { program: Command }) {
  program
    .command("insert")
    .requiredOption(
      "--roots <path...>",
      "Workspace directories; repeat the flag or provide multiple paths.",
    )
    .requiredOption("--repo <path>", "Git root of the workspace project the agent is working on.")
    .description(
      'Insert one memory from JSON containing body and frontmatter with title and scope. Search first for a related memory to update. Choose the narrowest scope where the memory provides useful context. For example, a login-session cookie rule used throughout authentication belongs to ["apps/web/auth"]. Use ["*"] only for context useful across the whole repository.',
    )
    .option("--input <file>", "Read one memory JSON object from a file; omit or use - for stdin.")
    .action(async (options: { roots: string[]; repo: string; input?: string }) => {
      const value = await readJsonInput({
        file: options.input,
        label: "insert",
        example:
          '{"body":"Markdown content","frontmatter":{"title":"Memory title","scope":["apps/web/auth"]}}',
      });
      const input = parseValue({ schema: insertSchema, value, label: "insert input" });
      const result = await insert({ ...input, roots: options.roots, repo: options.repo });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    });
}
