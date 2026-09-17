import { readFile } from "node:fs/promises";

/** Reads a single CLI payload from a file or all of stdin before parsing its JSON. */
export async function readJsonInput({
  file,
  label,
  example,
}: {
  file?: string;
  label: string;
  example: string;
}): Promise<unknown> {
  let text: string;
  if (file && file !== "-") {
    text = await readFile(file, "utf8");
  } else {
    // isTTY means a person is typing in a terminal, rather than piping JSON into mem.
    if (process.stdin.isTTY)
      throw new Error("Provide --input <file> or pipe one memory JSON object into stdin.");
    process.stdin.setEncoding("utf8");
    text = "";
    // A pipe arrives in chunks; wait for its end before parsing the full JSON object.
    for await (const chunk of process.stdin) text += chunk;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Invalid ${label} JSON: ${error instanceof Error ? error.message : "Unable to parse input."} Provide one JSON object with double-quoted keys and no comments or trailing commas, for example ${example}.`,
    );
  }
}
