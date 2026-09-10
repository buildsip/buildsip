import { BetterFetchError, ValidationError } from "@better-fetch/fetch";
import { describe, expect, it } from "vitest";
import { draftUploadErrorMessage } from "../draft-upload-error-message";

describe("draftUploadErrorMessage", () => {
  it("reads the error string off better-fetch's default JSON error object", () => {
    expect(
      draftUploadErrorMessage({
        error: "title: Invalid input: expected string, received undefined",
        status: 400,
        statusText: "Bad Request",
      }),
    ).toBe("title: Invalid input: expected string, received undefined");
  });

  it("reads the JSON body from BetterFetchError when throw is enabled", () => {
    expect(
      draftUploadErrorMessage(
        new BetterFetchError(400, "Bad Request", {
          error: "Note content is required.",
        }),
      ),
    ).toBe("Note content is required.");
  });

  it("falls back when the upload response does not match the draft schema", () => {
    expect(draftUploadErrorMessage(new ValidationError([]))).toBe(
      "BuildSip returned an invalid upload response.",
    );
  });
});
