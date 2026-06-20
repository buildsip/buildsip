import { saveSession } from "./auth-store";
import { config } from "./config";
import { fetchOpenIdConfiguration } from "./openid-configuration";
import { fetchToken } from "./token";
import type { AuthContext } from "./types";

export async function exchangeCode(
  ctx: AuthContext,
  input: {
    code: string;
    codeVerifier: string;
  },
) {
  ctx.log.debug("Exchanging authorization code for session.");
  const { tokenEndpoint } = await fetchOpenIdConfiguration(ctx);
  const token = await fetchToken(ctx, tokenEndpoint, {
    client_id: config.oauthClientId,
    code: input.code,
    code_verifier: input.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });

  if (!token.refreshToken) {
    throw new Error("Supabase did not return a refresh token.");
  }

  const session = saveSession(token, token.refreshToken);
  ctx.log.debug("Session saved.");
  return session;
}
