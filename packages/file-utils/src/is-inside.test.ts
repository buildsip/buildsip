import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { isInside } from "./index";

describe("isInside", () => {
  it("rejects paths sharing only a string prefix", () => {
    expect(isInside({ parent: resolve("repo"), path: resolve("repo-other") })).toBe(false);
  });

  it("normalizes dot segments before checking containment", () => {
    expect(isInside({ parent: "repo", path: "repo/src/../file.ts" })).toBe(true);
    expect(isInside({ parent: "repo", path: "repo/../outside" })).toBe(false);
  });

  it.skipIf(process.platform !== "win32")("rejects paths on a different drive", () => {
    expect(isInside({ parent: "C:\\repo", path: "D:\\repo\\child" })).toBe(false);
  });
  it("treats the same folder as inside", () => {
    expect(isInside({ parent: "/project/apps/web", path: "/project/apps/web" })).toBe(true);
  });

  it("treats a descendant as inside", () => {
    expect(
      isInside({
        parent: "/project/apps/web/src",
        path: "/project/apps/web/src/commands",
      }),
    ).toBe(true);
  });

  it("rejects the direct parent", () => {
    expect(
      isInside({
        parent: "/project/apps/web/src/commands",
        path: "/project/apps/web/src",
      }),
    ).toBe(false);
  });

  it("rejects a sibling", () => {
    expect(
      isInside({
        parent: "/project/apps/web/src/commands",
        path: "/project/apps/web/src/constants.ts",
      }),
    ).toBe(false);
  });
});
