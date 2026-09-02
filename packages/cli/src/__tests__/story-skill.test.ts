import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "../run-command";
import { uninstallStorySkill } from "../story-skill";

vi.mock("../run-command", () => ({
  runCommand: vi.fn(),
}));

describe("uninstallStorySkill", () => {
  beforeEach(() => {
    vi.mocked(runCommand).mockReset().mockResolvedValue("");
  });

  it("removes the global story skill from every agent", async () => {
    await uninstallStorySkill();

    expect(runCommand).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledWith("npx", [
      "-y",
      "--silent",
      "skills",
      "remove",
      "-g",
      "buildsip-story",
      "-y",
    ]);
  });
});
