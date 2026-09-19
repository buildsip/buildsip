import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { describeMemory } from "./describe-memory";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, readdir: vi.fn(original.readdir) };
});

let repo: string;
let data: string;
let path: string;

beforeEach(async () => {
  vi.mocked(readdir).mockReset();
  const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(readdir).mockImplementation(fs.readdir);
  repo = await realpath(await mkdtemp(join(tmpdir(), "mem-categories-")));
  data = join(repo, ".memories", "data");
  path = join(data, "saved-note");
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "memory.md"), "The listing must not need valid frontmatter.");
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

it("shows only data/ when no category folders exist", async () => {
  const result = await describeMemory({ path, repo });
  expect(result).toContain(`anywhere within ${JSON.stringify(data)}`);
  expect(result).toContain("Never move it outside this exact data directory");
  expect(result).toContain("create new parent directories");
  expect(result).toContain("act as tags when searching memories");
  expect(result).toContain("human-readable names");
  expect(result.split("looks like this:\n")[1]).toBe("data/");
});

it("lists empty categories but prunes memories, attachments, stages, and symbolic links", async () => {
  for (const folder of [
    "network/http",
    "rendering/hydration",
    "state/zustand/selectors",
    "saved-note/attachments/nested",
    ".mem-pending/unpublished",
  ]) {
    await mkdir(join(data, folder), { recursive: true });
  }
  await writeFile(join(data, "README.md"), "Ignore files");
  await symlink(repo, join(data, "linked-directory"));
  await symlink(join(repo, "missing"), join(data, "broken-link"));
  const result = await describeMemory({ path, repo });
  expect(result.split("looks like this:\n")[1]).toBe(
    "data/\ndata/network/\ndata/network/http/\ndata/rendering/\ndata/rendering/hydration/\ndata/state/\ndata/state/zustand/\ndata/state/zustand/selectors/",
  );
  // We may inspect a memory's entries to recognize it, but never descend into its attachments.
  expect(vi.mocked(readdir).mock.calls.map(([dir]) => dir)).not.toContain(
    join(path, "attachments"),
  );
});

it("keeps the actual store boundary when category names contain .memories/data", async () => {
  const nested = join(data, ".memories", "data", "nested-note");
  await mkdir(nested, { recursive: true });
  await writeFile(join(nested, "memory.md"), "Note");
  const result = await describeMemory({ path: nested, repo });
  expect(result).toContain(`anywhere within ${JSON.stringify(data)}`);
});

it.each([".memories", ".memories/data"])(
  "does not mistake a repository named %s for the owning store",
  async (name) => {
    const root = join(repo, "repos", name);
    const store = join(root, ".memories", "data");
    const memory = join(store, "note");
    await mkdir(memory, { recursive: true });
    await writeFile(join(memory, "memory.md"), "Note");
    const result = await describeMemory({ path: memory, repo: root });
    expect(result).toContain(`anywhere within ${JSON.stringify(store)}`);
    expect(result.split("looks like this:\n")[1]).toBe("data/");
  },
);

it("reports an unavailable listing without turning a successful save into a failed write", async () => {
  vi.mocked(readdir).mockRejectedValueOnce(new Error("Permission denied"));
  const result = await describeMemory({ path, repo });
  expect(result).toContain(`Memory saved at ${JSON.stringify(path)}`);
  expect(result).toContain("The data directory listing could not be read");
  expect(result).toContain("the memory was saved successfully");
  expect(result).not.toContain("looks like this:");
});
