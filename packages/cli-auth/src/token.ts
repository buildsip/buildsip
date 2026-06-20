import { betterFetch } from "@better-fetch/fetch";
import z from "zod";
import { readOAuthError, readOAuthErrorCode } from "./response";
import type { AuthContext, OAuthToken } from "./types";

export class OAuthTokenError extends Error {
  constructor(
    message: string,
    public readonly errorCode: string | undefined,
  ) {
    super(message);
    this.name = "OAuthTokenError";
  }
}

export async function fetchToken(
  ctx: AuthContext,
  tokenEndpoint: string,
  params: Record<string, string>,
) {
  ctx.log.debug(`Requesting OAuth token with grant ${params.grant_type}.`);

  const { data, error } = await betterFetch(tokenEndpoint, {
    body: new URLSearchParams(params),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
    output: z.object({
      access_token: z.string(),
      expires_in: z.number().positive(),
      refresh_token: z.string().optional(),
      token_type: z.string(),
    }),
  });

  if (error) {
    throw new OAuthTokenError(
      readOAuthError(error, "Failed to exchange OAuth token."),
      readOAuthErrorCode(error),
    );
  }

  ctx.log.debug("OAuth token response received.");
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    refreshToken: data.refresh_token,
  } satisfies OAuthToken;
}
