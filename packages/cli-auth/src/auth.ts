import { deleteSession, saveSession, Session } from "./auth-store";
import { findSession } from "./auth-store";
import { config } from "./config";
import { fetchOpenIdConfiguration } from "./openid-configuration";
import { OAuthTokenError, fetchToken } from "./token";
import type { AuthContext } from "./types";

export type AuthResult = {
  error?: Error;
  session?: Session;
};

async function refreshSession(
  ctx: AuthContext,
  session: Session,
): Promise<AuthResult> {
  try {
    const { tokenEndpoint } = await fetchOpenIdConfiguration(ctx);
    const token = await fetchToken(ctx, tokenEndpoint, {
      client_id: config.oauthClientId,
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
    });

    const refreshedSession = saveSession(
      token,
      // Normal OAuth behavior. A server may rotate refresh tokens, but it does not have to.
      // If it sends a new one, replace the old one. If it does not, keep the old one.
      token.refreshToken ?? session.refreshToken,
    );
    ctx.log.debug("Session refreshed.");
    return { session: refreshedSession };
  } catch (error) {
    ctx.log.debug(error);
    /**
     * OpenID Connect token errors use OAuth's registered error names:
     * @see https://www.iana.org/assignments/oauth-parameters/oauth-parameters.xhtml#extensions-error
     */
    if (
      error instanceof OAuthTokenError &&
      error.errorCode === "invalid_grant"
    ) {
      deleteSession();
      return {
        error: new Error(
          "Your saved session expired or was revoked. Run buildsip login to sign in again.",
        ),
      };
    }

    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export async function auth(ctx: AuthContext): Promise<AuthResult> {
  const session = findSession();

  if (!session) {
    ctx.log.debug("No saved session found.");
    return { error: new Error("Not logged in. Run buildsip login first.") };
  }

  if (session.expiresAt > Date.now() + config.refreshWindowMs) {
    ctx.log.debug("Saved session is fresh.");
    return { session };
  }

  ctx.log.debug("Refreshing session.");
  return refreshSession(ctx, session);
}
