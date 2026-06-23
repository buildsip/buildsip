import { createHash, randomBytes } from "node:crypto";

export function generatePkce() {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  return {
    codeChallenge,
    codeVerifier,
    state: randomBytes(32).toString("base64url"),
  };
}
