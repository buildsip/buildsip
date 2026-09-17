import type { ErrorObject } from "ajv";
import { z } from "zod";

/** Ajv still handles custom JSON Schema; expose its field paths and constraints to the agent. */
export function formatSchemaErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => {
      // Ajv uses JSON Pointer escaping for field names containing / or ~.
      const path: PropertyKey[] = [
        "frontmatter",
        ...error.instancePath
          .split("/")
          .slice(1)
          .map((part) => {
            const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
            return /^\d+$/.test(key) ? Number(key) : key;
          }),
      ];
      let expected = error.parentSchema;
      let message = error.message;
      if (error.keyword === "required") {
        path.push(error.params.missingProperty);
        expected = error.parentSchema?.properties?.[error.params.missingProperty];
        message = "Expected this required field";
      } else if (error.keyword === "additionalProperties") {
        path.push(error.params.additionalProperty);
        message = "Remove this unknown field; allowed fields and patterns are defined below";
      } else if (error.keyword === "enum") {
        message = `Expected one of ${JSON.stringify(error.params.allowedValues)}`;
      } else if (error.keyword === "const") {
        message = `Expected ${JSON.stringify(error.params.allowedValue)}`;
      }
      return `${z.core.toDotPath(path)}: ${message}${expected === undefined ? "." : `. Expected schema: ${JSON.stringify(expected)}`}`;
    })
    .join("; ");
}
