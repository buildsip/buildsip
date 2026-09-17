/**
 * Recursively overlays local config objects onto inherited config.
 * Values from this config override parent inherited values.
 */
export function mergeConfig({
  base,
  local,
}: {
  base: Record<string, unknown>;
  local: Record<string, unknown>;
}): Record<string, unknown> {
  const merged = { ...base };
  for (const [key, value] of Object.entries(local)) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new Error(`Invalid config key: ${key}`);
    const previous = merged[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      previous &&
      typeof previous === "object" &&
      !Array.isArray(previous)
    ) {
      merged[key] = mergeConfig({
        base: previous as Record<string, unknown>,
        local: value as Record<string, unknown>,
      });
    } else {
      merged[key] = value;
    }
  }
  return merged;
}
