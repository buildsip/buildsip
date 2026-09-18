import { expect, it } from "vitest";
import { parseValue } from "./parse-value";
import { insertSchema } from "./insert-schema";
import { updateSchema } from "./update-schema";
import { validateFrontmatter } from "./validate-frontmatter";

it.each([
  {
    field: "frontmatter.title",
    input: { title: " " },
    expected: "Expected a nonempty string for the memory title",
  },
  {
    field: "frontmatter.id",
    input: { id: null },
    expected: "Omit id",
  },
  {
    field: "frontmatter.scope",
    input: { scope: "apps/web" },
    expected: "Expected a nonempty array of repository-relative",
  },
  {
    field: "frontmatter.scope",
    input: { scope: [] },
    expected: "Expected a nonempty array of repository-relative",
  },
  {
    field: "frontmatter.scope[1]",
    input: { scope: ["apps/web", 42] },
    expected: "Expected a repository-relative file or directory path",
  },
  {
    field: "frontmatter.scope[1]",
    input: { scope: ["apps/web", "../outside"] },
    expected: "absolute paths, exclusions, and .. are not allowed",
  },
  {
    field: "frontmatter.scope[1]",
    input: { scope: ["apps/web", "apps/*"] },
    expected: "Globs are not supported",
  },
  {
    field: "frontmatter.doNotEdit",
    input: { doNotEdit: "true" },
    expected: "Expected a boolean: true or false",
  },
  {
    field: "frontmatter.doNotDelete",
    input: { doNotDelete: null },
    expected: "Expected a boolean: true or false",
  },
])("gives a self-contained correction for $field: $input", ({ field, input, expected }) => {
  expect(() =>
    parseValue({
      schema: insertSchema,
      label: "insert input",
      value: { body: "Markdown", frontmatter: { title: "Title", scope: ["*"], ...input } },
    }),
  ).toThrow(
    new RegExp(
      `${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\n]*\n  → at ${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\n|$)`,
    ),
  );
});

it("reports all missing fields together with their expected contents", () => {
  expect(() =>
    parseValue({ schema: insertSchema, label: "insert input", value: { frontmatter: {} } }),
  ).toThrow(
    /Expected a nonempty string[^\n]*\n  → at body\n[\s\S]*Expected a nonempty string[^\n]*\n  → at frontmatter.title\n[\s\S]*Expected a nonempty array[^\n]*\n  → at frontmatter.scope/,
  );
});

it("names unknown top-level keys and explains where memory fields belong", () => {
  expect(() =>
    parseValue({
      schema: insertSchema,
      label: "insert input",
      value: {
        body: "Markdown",
        frontmatter: { title: "Title", scope: ["*"] },
        typo: true,
        custom: {},
      },
    }),
  ).toThrow(
    /Remove this unknown field.*Only body and frontmatter[^\n]*\n  → at typo\n[\s\S]*Remove this unknown field[^\n]*\n  → at custom/,
  );
});

it("reports the invalid entry in a stored scope array", () => {
  expect(() =>
    validateFrontmatter({
      value: { id: "id", title: "Title", scope: ["apps/web", 1] },
      config: {},
      path: "/repo/memory.md",
    }),
  ).toThrow(
    /Expected a repository-relative file or directory path[^\n]*\n  → at frontmatter.scope\[1\]/,
  );
});

it.each(["apps/web", "*", []])("rejects stored scope outside the array contract: %j", (scope) => {
  expect(() =>
    validateFrontmatter({
      value: { id: "id", title: "Title", scope },
      config: {},
      path: "/repo/memory.md",
    }),
  ).toThrow("frontmatter.scope");
});

it("requires the stored ID while allowing scope to be inherited", () => {
  const value = { id: "id", title: "Title" };
  expect(validateFrontmatter({ value, config: {}, path: "/repo/memory.md" })).toEqual(value);
  expect(() =>
    validateFrontmatter({ value: { title: "Title" }, config: {}, path: "/repo/memory.md" }),
  ).toThrow("frontmatter.id");
});

it("keeps Ajv custom schema validation and reports required fields, array indices, and enum choices", () => {
  expect(() =>
    validateFrontmatter({
      value: { id: "id", title: "Title", status: "unknown", anchors: [42] },
      path: "/repo/memory.md",
      config: {
        frontmatter: {
          custom: {
            properties: {
              ticket: { type: "string", pattern: "^ENG-" },
              status: { enum: ["draft", "ready"] },
              anchors: { type: "array", items: { type: "string" } },
            },
            required: ["ticket"],
          },
        },
      },
    }),
  ).toThrow(
    /frontmatter.ticket: Expected this required field.*ENG-.*frontmatter.status: Expected one of \["draft","ready"\].*frontmatter.anchors\[0\]: must be string/,
  );
});

it("preserves Markdown whitespace and custom fields when parsing JSON input", () => {
  const value = {
    body: "  indented code\n\n",
    frontmatter: { title: "Title", scope: ["*"], ticket: "ENG-1", details: { anchors: ["a"] } },
  };
  expect(parseValue({ schema: insertSchema, label: "insert input", value })).toEqual(value);
});

it.each([
  { value: { path: "memory.md" }, field: "path", error: "Pass the memory path via --path" },
  { value: { body: "" }, field: "body", error: "Expected a nonempty string" },
  {
    value: { frontmatter: { title: " " } },
    field: "frontmatter.title",
    error: "Expected a nonempty string",
  },
  {
    value: { frontmatter: { scope: [] } },
    field: "frontmatter.scope",
    error: "Expected a nonempty array",
  },
  {
    value: { frontmatter: { id: "existing-id" } },
    field: "frontmatter.id",
    error: "Omit id",
  },
  {
    value: { frontmatter: { title: null } },
    field: "frontmatter.title",
    error: "Expected a nonempty string",
  },
  {
    value: { id: "existing-id" },
    field: "id",
    error: "Remove this unknown field",
  },
  {
    value: { frontmatter: null },
    field: "frontmatter",
    error: "Expected an object",
  },
])("rejects invalid partial updates with a correction: $value", ({ value, field, error }) => {
  const parse = () => parseValue({ schema: updateSchema, value, label: "update input" });
  expect(parse).toThrow(error);
  expect(parse).toThrow(`→ at ${field}`);
});

it.each(["provided-id", null])("rejects caller-supplied IDs on insert: %s", (id) => {
  expect(() =>
    parseValue({
      schema: insertSchema,
      label: "insert input",
      value: {
        body: "body",
        frontmatter: { title: "Title", scope: ["*"], id },
      },
    }),
  ).toThrow(/Omit id[^\n]*\n  → at frontmatter.id/);
});

it("accepts an empty patch for a folder-name repair", () => {
  expect(parseValue({ schema: updateSchema, value: {}, label: "update input" })).toEqual({});
});
