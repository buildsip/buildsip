/**
 * Isolates child-process agent configs from the developer's real home and agent overrides.
 * */
export function cliEnv({ home }: { home: string }): Record<string, string> {
  const env: Record<string, string> = { HOME: home, USERPROFILE: home };
  for (const key of ["PATH", "SystemRoot", "TEMP", "TMP"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}
