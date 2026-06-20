export type OAuthToken = {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
};

export type AuthContext = {
  log: {
    debug(message: unknown): void;
  };
};

export type UserInfo = {
  email?: string;
  name?: string;
  picture?: string;
  sub?: string;
};

export type { Session } from "./auth-store";
