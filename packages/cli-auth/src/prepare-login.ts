import { buildAuthorizationUrl } from "./authorization-url";
import { generatePkce } from "./pkce";
import type { AuthContext } from "./types";

export async function prepareLogin(ctx: AuthContext) {
  const { codeChallenge, codeVerifier, state } = generatePkce();
  const authorizationUrl = await buildAuthorizationUrl(ctx, {
    codeChallenge,
    state,
  });

  return {
    authorizationUrl,
    codeVerifier,
    state,
  };
}
