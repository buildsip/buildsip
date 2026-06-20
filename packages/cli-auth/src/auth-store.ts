import { join } from "node:path";
import Conf from "conf";
import { findBuildSipHomeDir } from "./find-buildsip-home-dir";
import { config } from "./config";
import { OAuthToken } from "./types";

export type Session = {
  accessToken: string;
  expiresAt: number;
  refreshToken: string;
};

let store: Conf<Session> | undefined;

function findStore() {
  store ??= new Conf<Session>({
    accessPropertiesByDotNotation: false,
    configFileMode: 0o600,
    configName: config.configName,
    cwd: findBuildSipHomeDir(),
  });

  return store;
}

/**
 * Find the session stored in auth.json, in ~/.buildsip.
 */
export function findSession() {
  const accessToken = findStore().get("accessToken");
  const refreshToken = findStore().get("refreshToken");
  const expiresAt = findStore().get("expiresAt");

  if (!accessToken || !refreshToken || expiresAt === undefined) {
    return undefined;
  }

  return { accessToken, expiresAt, refreshToken };
}

/**
 * Save the session to auth.json, in ~/.buildsip.
 */
export function saveSession(token: OAuthToken, refreshToken: string) {
  const session = {
    accessToken: token.accessToken,
    expiresAt: Date.now() + token.expiresIn * 1000,
    refreshToken,
  } satisfies Session;

  const config = findStore();
  config.set("accessToken", session.accessToken);
  config.set("expiresAt", session.expiresAt);
  config.set("refreshToken", session.refreshToken);

  return session;
}

export function deleteSession() {
  findStore().clear();
}

export function findAuthStorePath() {
  return join(findBuildSipHomeDir(), `${config.configName}.json`);
}
