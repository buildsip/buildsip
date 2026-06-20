import z from "zod";

const oauthErrorSchema = z.object({
  error: z.string().optional(),
  error_description: z.string().optional(),
  msg: z.string().optional(),
});

export function readOAuthError(value: unknown, fallback: string) {
  const result = oauthErrorSchema.safeParse(value);

  if (!result.success) {
    return fallback;
  }

  return (
    result.data.error_description ??
    result.data.error ??
    result.data.msg ??
    fallback
  );
}

export function readOAuthErrorCode(value: unknown) {
  const result = oauthErrorSchema.safeParse(value);

  if (!result.success) {
    return undefined;
  }

  return result.data.error;
}
