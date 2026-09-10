import { BetterFetchError, ValidationError } from "@better-fetch/fetch";
import z from "zod";

export function draftUploadErrorMessage(error: unknown) {
  if (error instanceof ValidationError) {
    return "BuildSip returned an invalid upload response.";
  }

  // better-fetch only constructs BetterFetchError when `throw: true`. The
  // default `{ data, error }` result is the JSON body plus status fields.
  const response = z.object({ error: z.string() }).safeParse(error);

  if (response.success) {
    return response.data.error;
  }

  if (error instanceof BetterFetchError) {
    const body = z.object({ error: z.string() }).safeParse(error.error);
    return body.success
      ? body.data.error
      : `Draft upload failed with status ${error.status}.`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Upload failed.";
}
