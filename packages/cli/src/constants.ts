export const config = {
  get apiBaseUrl() {
    return process.env.BUILDSIP_URL ?? "https://buildsip.dev";
  },
};
