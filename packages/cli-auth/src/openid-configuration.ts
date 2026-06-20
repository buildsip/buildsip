import { betterFetch } from "@better-fetch/fetch";
import z from "zod";
import type { AuthContext } from "./types";
import { config } from "./config";

type OpenIdConfiguration = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userInfoEndpoint: string;
};

let cachedOpenIdConfiguration: OpenIdConfiguration | undefined;

export async function fetchOpenIdConfiguration(ctx: AuthContext) {
  try {
    if (cachedOpenIdConfiguration) {
      ctx.log.debug("Using cached OpenID configuration.");
      return cachedOpenIdConfiguration;
    }

    ctx.log.debug("Fetching OpenID configuration.");

    const data = await betterFetch(
      new URL("/.well-known/openid-configuration", config.issuerUrl).toString(),
      {
        headers: {
          Accept: "application/json",
        },
        output: z.object({
          authorization_endpoint: z.url(),
          token_endpoint: z.url(),
          userinfo_endpoint: z.url(),
        }),
        throw: true,
      },
    );

    cachedOpenIdConfiguration = {
      authorizationEndpoint: data.authorization_endpoint,
      tokenEndpoint: data.token_endpoint,
      userInfoEndpoint: data.userinfo_endpoint,
    };

    ctx.log.debug("OpenID configuration loaded.");

    return cachedOpenIdConfiguration;
  } catch (error) {
    ctx.log.debug(error);
    throw new Error("BuildSip is unavailable. Try again in a moment.");
  }
}
