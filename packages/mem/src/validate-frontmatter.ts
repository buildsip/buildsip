import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { ValidateFunction } from "ajv";
import { z } from "zod";
import { storedFrontmatterSchema } from "./stored-frontmatter-schema";
import { formatSchemaErrors } from "./format-schema-errors";
import { parseValue } from "./parse-value";
import type { Config } from "./read-config";

export type Frontmatter = z.infer<typeof storedFrontmatterSchema>;

const ajv = new Ajv({ allErrors: true, strict: false, logger: false, verbose: true });
addFormats(ajv);
const schemas = new Map<string, ValidateFunction>();

/**
 * Validates built-in memory fields, including any explicit scope paths.
 * Extra fields are checked separately against the configured custom JSON Schema;
 * compiled custom validators are cached for reuse across memories.
 */
export function validateFrontmatter({
  value,
  config,
  path,
}: {
  value: unknown;
  config: Config;
  path: string;
}): Frontmatter {
  const frontmatter = parseValue({
    schema: storedFrontmatterSchema,
    value,
    label: `frontmatter ${path}`,
    path: ["frontmatter"],
  });
  const custom = Object.fromEntries(
    Object.entries(frontmatter).filter(
      ([key]) => !["id", "title", "scope", "doNotEdit", "doNotDelete"].includes(key),
    ),
  );
  const schema = config.frontmatter?.custom;
  if (!schema && Object.keys(custom).length)
    throw new Error(
      `Invalid frontmatter ${path}: ${Object.keys(custom)
        .map((key) => z.core.toDotPath(["frontmatter", key]))
        .join(
          ", ",
        )}: remove these undeclared fields or define their JSON Schema under frontmatter.custom in the repository root's .memories/config.json, for example {"frontmatter":{"custom":{"properties":{"ticket":{"type":"string"}}}}}. Custom fields go next to title, not inside a custom object.`,
    );
  if (schema) {
    // Reuse the compiled schema when several writes use the same repo configuration.
    const key = JSON.stringify(schema);
    let validateCustom = schemas.get(key);
    if (!validateCustom) {
      validateCustom = ajv.compile({ type: "object", ...schema });
      if (schemas.size >= 100) schemas.clear();
      schemas.set(key, validateCustom);
    }
    if (!validateCustom(custom))
      throw new Error(
        `Invalid custom frontmatter ${path}: ${formatSchemaErrors(validateCustom.errors)}`,
      );
  }
  return frontmatter;
}
