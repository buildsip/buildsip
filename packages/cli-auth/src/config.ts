export const config = {
  configName: "auth",
  get issuerUrl() {
    return process.env.BUILDSIP_URL ?? "https://buildsip.dev";
  },
  loginTimeoutMs: 5 * 60 * 1000, // 5 minutes
  get oauthClientId() {
    return (
      process.env.BUILDSIP_OAUTH_CLIENT_ID ??
      "bb41cd35-7de0-461e-9d9b-4bc6a65c46ee"
    );
  },
  redirectUri: "http://127.0.0.1:48271/callback",
  refreshWindowMs: 60 * 1000, // 1 minute
  scope: "email profile",
  get loginCompleteUrl() {
    return `${config.issuerUrl}/cli/signin/complete`;
  },
} as const;

export function loginCompleteErrorUrl(message: string) {
  const url = new URL(config.loginCompleteUrl);
  url.searchParams.set("error", message);
  return url.toString();
}
