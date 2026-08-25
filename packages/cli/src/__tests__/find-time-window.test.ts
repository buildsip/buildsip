import { describe, expect, it } from "vitest";
import { findTimeWindow } from "../find-time-window";

describe("findTimeWindow", () => {
  it("uses the timezone offsets in an explicit range", () => {
    expect(
      findTimeWindow({
        since: "2026-08-25T00:00:00+03:00",
        until: "2026-08-26T00:00:00+03:00",
      }),
    ).toEqual({
      since: new Date("2026-08-24T21:00:00.000Z"),
      until: new Date("2026-08-25T21:00:00.000Z"),
    });
  });
});
