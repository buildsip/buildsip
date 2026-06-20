import { betterFetch } from "@better-fetch/fetch";
import z from "zod";
import { fetchOpenIdConfiguration } from "./openid-configuration";
import { readOAuthError } from "./response";
import type { AuthContext, Session, UserInfo } from "./types";

export async function fetchUser(ctx: AuthContext, session: Session) {
  ctx.log.debug("Fetching user info.");
  const { userInfoEndpoint } = await fetchOpenIdConfiguration(ctx);

  const { data, error } = await betterFetch(userInfoEndpoint, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
    },
    output: z.object({
      email: z.string().optional(),
      name: z.string().optional(),
      picture: z.string().optional(),
      sub: z.string().optional(),
    }),
  });

  if (error) {
    throw new Error(readOAuthError(error, "Failed to fetch user info."));
  }

  return {
    email: data.email,
    name: data.name,
    picture: data.picture,
    sub: data.sub,
  } satisfies UserInfo;
}
