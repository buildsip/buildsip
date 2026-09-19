import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertNoSymlinks,
  findUp,
  lstatIfExists,
  readTextIfExists,
  readTextIfExistsSync,
  statIfExists,
} from "./index";

let root: string;

beforeEach(async () => {
  // Canonicalize the macOS temporary directory, whose short name can be a symlink.
  root = await realpath(await mkdtemp(join(tmpdir(), "file-utils-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe.each([
  { name: "statIfExists", inspect: statIfExists },
  { name: "lstatIfExists", inspect: lstatIfExists },
])("$name", ({ inspect }) => {
  it("distinguishes a missing entry, file, and directory", async () => {
    const path = join(root, "file.txt");
    expect(await inspect({ path })).toBeUndefined();
    await writeFile(path, "hello");
    expect((await inspect({ path }))?.isFile()).toBe(true);
    expect((await inspect({ path: root }))?.isDirectory()).toBe(true);
  });

  it("only treats a file ancestor as a missing path when requested", async () => {
    const file = join(root, "file.txt");
    await writeFile(file, "hello");
    const path = join(file, "package.json");
    await expect(inspect({ path })).rejects.toMatchObject({ code: "ENOTDIR" });
    expect(await inspect({ path, ignoreNotDirectory: true })).toBeUndefined();
  });

  it("does not hide invalid-path errors", async () => {
    await expect(
      inspect({ path: "bad\0path", ignoreNotDirectory: true }),
    ).rejects.toMatchObject({
      code: "ERR_INVALID_ARG_VALUE",
    });
  });
});

it("distinguishes a symbolic link from its target, including a dangling link", async () => {
  const target = join(root, "target");
  const link = join(root, "link");
  await mkdir(target);
  await symlink(target, link, "dir");
  expect((await statIfExists({ path: link }))?.isDirectory()).toBe(true);
  expect((await lstatIfExists({ path: link }))?.isSymbolicLink()).toBe(true);
  await rm(target, { recursive: true });
  expect(await statIfExists({ path: link })).toBeUndefined();
  expect((await lstatIfExists({ path: link }))?.isSymbolicLink()).toBe(true);
});

describe.each([
  { name: "readTextIfExists", read: readTextIfExists },
  { name: "readTextIfExistsSync", read: readTextIfExistsSync },
])("$name", ({ read }) => {
  it("distinguishes missing files, empty files, and UTF-8 text", async () => {
    const path = join(root, "text.txt");
    expect(await read(path)).toBeUndefined();
    await writeFile(path, "");
    expect(await read(path)).toBe("");
    await writeFile(path, "café ☕\n");
    expect(await read(path)).toBe("café ☕\n");
  });

  it("propagates ENOTDIR rather than treating an invalid location as absent", async () => {
    const file = join(root, "file.txt");
    await writeFile(file, "hello");
    await expect(Promise.resolve().then(() => read(join(file, "child")))).rejects.toMatchObject({
      code: "ENOTDIR",
    });
  });
});

describe("assertNoSymlinks", () => {
  it("allows existing files and destinations that do not exist yet", async () => {
    const file = join(root, "file.txt");
    await writeFile(file, "hello");
    await assertNoSymlinks({ path: root, base: root });
    await assertNoSymlinks({ path: file, base: root });
    await assertNoSymlinks({ path: join(root, "new", "child.txt"), base: root });
  });

  it("rejects paths outside the base even when they do not exist", async () => {
    await expect(assertNoSymlinks({ path: `${root}-other`, base: root })).rejects.toThrow(
      "outside",
    );
  });

  it("rejects links at the base, in an ancestor, and at the final entry", async () => {
    const target = join(root, "target");
    const link = join(root, "link");
    await mkdir(target);
    await symlink(target, link, "dir");
    await expect(assertNoSymlinks({ path: join(link, "new"), base: link })).rejects.toThrow(
      "Symbolic links",
    );
    await expect(assertNoSymlinks({ path: join(link, "new"), base: root })).rejects.toThrow(
      "Symbolic links",
    );
    await expect(assertNoSymlinks({ path: link, base: root })).rejects.toThrow("Symbolic links");
    await rm(target, { recursive: true });
    await expect(assertNoSymlinks({ path: link, base: root })).rejects.toThrow("Symbolic links");
  });

  it("does not ignore an existing file in place of a parent directory", async () => {
    const file = join(root, "file.txt");
    await writeFile(file, "hello");
    await expect(assertNoSymlinks({ path: join(file, "child"), base: root })).rejects.toMatchObject(
      {
        code: "ENOTDIR",
      },
    );
  });
});

it("finds a package from a file or missing path without matching above the selected root", async () => {
  const project = join(root, "project");
  const source = join(project, "src");
  await mkdir(source, { recursive: true });
  await writeFile(join(root, "package.json"), "{}");
  await writeFile(join(project, "package.json"), "{}");
  const file = join(source, "index.ts");
  await writeFile(file, "");
  const test = async (path: string) =>
    (
      await statIfExists({ path: join(path, "package.json"), ignoreNotDirectory: true })
    )?.isFile() === true;
  for (const path of [file, join(source, "missing", "file.ts")]) {
    expect(await findUp({ path, root: project, test })).toBe(project);
  }
  await rm(join(project, "package.json"));
  expect(await findUp({ path: file, root: project, test })).toBeUndefined();
});
