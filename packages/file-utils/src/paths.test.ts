import { dirname, join, parse, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findUp, getAncestors, relativePosix } from "./index";

const root = resolve("example");
const child = join(root, "src", "commands");

describe("getAncestors", () => {
  it("includes the starting path and root in nearest-first order", () => {
    expect(getAncestors({ path: child, root })).toEqual([child, dirname(child), root]);
  });

  it("resolves relative paths and handles identical endpoints", () => {
    expect(getAncestors({ path: "example/./src/..", root: "example" })).toEqual([root]);
  });

  it("defaults to the filesystem root without requiring paths to exist", () => {
    const ancestors = getAncestors({ path: child });
    expect(ancestors[0]).toBe(child);
    expect(ancestors.at(-1)).toBe(parse(child).root);
    expect(getAncestors({ path: parse(child).root })).toEqual([parse(child).root]);
  });

  it("rejects a sibling root even when it shares a string prefix", () => {
    expect(() => getAncestors({ path: `${root}-other`, root })).toThrow("outside");
  });

  it.skipIf(process.platform !== "win32")("recognizes equivalent root casing on Windows", () => {
    expect(getAncestors({ path: child, root: root.toUpperCase() })).toEqual([
      child,
      dirname(child),
      root,
    ]);
  });
});

describe("findUp", () => {
  it("awaits predicates and stops at the nearest match", async () => {
    const visited: string[] = [];
    const found = await findUp({
      path: child,
      root,
      test: async (path) => {
        await Promise.resolve();
        visited.push(path);
        return path === dirname(child) || path === root;
      },
    });
    expect(found).toBe(dirname(child));
    expect(visited).toEqual([child, dirname(child)]);
  });

  it("can match the starting path", async () => {
    expect(await findUp({ path: child, root, test: () => true })).toBe(child);
  });

  it("includes the root and never tests above it", async () => {
    expect(await findUp({ path: child, root, test: (path) => path === root })).toBe(root);
    const visited: string[] = [];
    expect(
      await findUp({
        path: child,
        root,
        test: (path) => {
          visited.push(path);
          return false;
        },
      }),
    ).toBeUndefined();
    expect(visited).toEqual([child, dirname(child), root]);
  });

  it("defaults to the filesystem root", async () => {
    const top = parse(child).root;
    expect(await findUp({ path: child, test: (path) => path === top })).toBe(top);
  });

  it("propagates predicate errors", async () => {
    const error = new Error("Cannot inspect path");
    await expect(
      findUp({
        path: child,
        test: async () => {
          throw error;
        },
      }),
    ).rejects.toBe(error);
  });

  it("rejects an unrelated root before calling the predicate", async () => {
    const visited: string[] = [];
    await expect(
      findUp({
        path: child,
        root: `${root}-other`,
        test: (path) => {
          visited.push(path);
          return true;
        },
      }),
    ).rejects.toThrow("outside");
    expect(visited).toEqual([]);
  });
});

describe("relativePosix", () => {
  it("formats descendants and parents with forward slashes", () => {
    expect(relativePosix({ from: root, to: child })).toBe("src/commands");
    expect(relativePosix({ from: child, to: root })).toBe("../..");
  });

  it("leaves the same-path representation to the caller", () => {
    expect(relativePosix({ from: root, to: root })).toBe("");
  });

  it.skipIf(process.platform === "win32")("preserves backslashes in Unix filenames", () => {
    expect(relativePosix({ from: root, to: join(root, "a\\b", "file") })).toBe("a\\b/file");
  });

  it.skipIf(process.platform !== "win32")("preserves a different drive as an absolute path", () => {
    expect(relativePosix({ from: "C:\\repo", to: "D:\\other" })).toBe("D:/other");
  });
});
