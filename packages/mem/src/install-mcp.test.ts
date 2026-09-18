import { detectGlobalAgents, upsertServer } from "add-mcp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMcp } from "./install-mcp";

vi.mock("add-mcp", () => ({ detectGlobalAgents: vi.fn(), upsertServer: vi.fn() }));
const ctx = { log: { warn: vi.fn() } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(detectGlobalAgents).mockResolvedValue(["cursor", "claude-code"]);
  vi.mocked(upsertServer).mockReturnValue({ success: true, path: "/config" });
});

describe("installMcp", () => {
  it("refreshes every detected agent on every call with named approvals and global scope", async () => {
    await installMcp(ctx);
    await installMcp(ctx);
    expect(detectGlobalAgents).toHaveBeenCalledTimes(2);
    expect(upsertServer).toHaveBeenCalledTimes(4);
    for (const agent of ["cursor", "claude-code"]) {
      expect(upsertServer).toHaveBeenCalledWith(
        agent,
        "mem-cli",
        {
          command: "mem-cli",
          args: ["mcp"],
          autoApproveTools: [
            "insert-memory",
            "update-memory",
            "search-memories",
            "delete-memories",
          ],
        },
        { local: false },
      );
    }
    expect(ctx.log.warn).not.toHaveBeenCalled();
  });

  it("warns with manual setup instructions when no agents are detected", async () => {
    vi.mocked(detectGlobalAgents).mockResolvedValue([]);
    await installMcp(ctx);
    expect(upsertServer).not.toHaveBeenCalled();
    expect(ctx.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("api-reference/mcp/installation.md"),
    );
    expect(ctx.log.warn).toHaveBeenCalledWith(expect.stringContaining('arguments ["mcp"]'));
  });

  it("continues after a failed agent config", async () => {
    vi.mocked(upsertServer).mockReturnValueOnce({
      success: false,
      path: "/cursor/mcp.json",
      error: "Permission denied",
    });
    await installMcp(ctx);
    expect(upsertServer).toHaveBeenCalledTimes(2);
    expect(ctx.log.warn).toHaveBeenCalledWith(expect.stringContaining("Permission denied"));
    expect(ctx.log.warn).toHaveBeenCalledWith(expect.stringContaining("Fix this agent's config"));
  });

  it("continues if an adapter throws and tolerates detection failure", async () => {
    vi.mocked(upsertServer).mockImplementationOnce(() => {
      throw new Error("adapter failed");
    });
    await installMcp(ctx);
    expect(upsertServer).toHaveBeenCalledTimes(2);
    vi.mocked(detectGlobalAgents).mockRejectedValueOnce(new Error("detection failed"));
    await expect(installMcp(ctx)).resolves.toBeUndefined();
    expect(ctx.log.warn).toHaveBeenCalledWith(expect.stringContaining("detection failed"));
  });
});
