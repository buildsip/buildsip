import { config } from "./config";
import { fetchOpenIdConfiguration } from "./openid-configuration";
import type { AuthContext } from "./types";

export async function buildAuthorizationUrl(
  ctx: AuthContext,
  input: {
    codeChallenge: string;
    state: string;
  },
) {
  const { authorizationEndpoint } = await fetchOpenIdConfiguration(ctx);
  const url = new URL(authorizationEndpoint);
  url.searchParams.set("client_id", config.oauthClientId);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", input.state);
  ctx.log.debug("Built authorization URL.");
  return url.toString();
}
