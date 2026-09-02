import { describe, expect, it } from "vitest";
import { removeGlobalHooks } from "../../../hooks/src/global-hooks";

describe("removeGlobalHooks", () => {
  it("removes OpenAI hooks and their BuildSip-only groups", () => {
    const buildSipHook = {
      command: "buildsip log --agent codex",
      timeout: 30,
    };
    const otherHook = {
      command: "other log command",
      timeout: 10,
    };
    const config = {
      hooks: {
        Stop: [{ hooks: [otherHook] }],
        UserPromptSubmit: [
          { hooks: [buildSipHook] },
          { hooks: [buildSipHook], matcher: "project" },
          { hooks: [otherHook, buildSipHook] },
          "keep this value",
        ],
        custom: ["keep this event"],
      },
      theme: "dark",
    };

    expect(removeGlobalHooks({ config, name: "codex" })).toEqual({
      config: {
        hooks: {
          Stop: [{ hooks: [otherHook] }],
          UserPromptSubmit: [
            { hooks: [], matcher: "project" },
            { hooks: [otherHook] },
            "keep this value",
          ],
          custom: ["keep this event"],
        },
        theme: "dark",
      },
      removed: 3,
    });
  });

  it("removes Cursor hooks while preserving its config containers", () => {
    const otherHook = {
      command: "other log command",
      timeout: 10,
    };
    const config = {
      hooks: {
        afterAgentResponse: [
          {
            command: "buildsip log --agent cursor",
            timeout: 30,
          },
        ],
        beforeSubmitPrompt: [
          otherHook,
          {
            command: "buildsip log --agent cursor",
            timeout: 30,
          },
        ],
        custom: ["keep this event"],
      },
      version: 7,
    };

    expect(removeGlobalHooks({ config, name: "cursor" })).toEqual({
      config: {
        hooks: {
          afterAgentResponse: [],
          beforeSubmitPrompt: [otherHook],
          custom: ["keep this event"],
        },
        version: 7,
      },
      removed: 2,
    });
  });

  it("leaves configs without BuildSip hooks unchanged", () => {
    const config = {
      hooks: {
        Stop: [{ hooks: [{ command: "other log command" }] }],
      },
    };
    const result = removeGlobalHooks({ config, name: "claude-code" });

    expect(result).toEqual({ config, removed: 0 });
    expect(result.config).toBe(config);
  });
});
