import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "../run-command";
import { uninstallNoteSkill } from "../note-skill";

vi.mock("../run-command", () => ({
  runCommand: vi.fn(),
}));

describe("uninstallNoteSkill", () => {
  beforeEach(() => {
    vi.mocked(runCommand).mockReset().mockResolvedValue("");
  });

  it("removes the global note skill from every agent", async () => {
    await uninstallNoteSkill();

    expect(runCommand).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledWith("npx", [
      "-y",
      "--silent",
      "skills",
      "remove",
      "-g",
      "buildsip-note",
      "-y",
    ]);
  });
});
