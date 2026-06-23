export const config = {
  configName: "auth",
  get issuerUrl() {
    return process.env.BUILDSIP_URL ?? "https://buildsip.com";
  },
  loginTimeoutMs: 5 * 60 * 1000, // 5 minutes
  get oauthClientId() {
    return process.env.OAUTH_CLIENT_ID ?? "07ab6d95-c832-4361-ba75-f8c8a3a486d3";
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
