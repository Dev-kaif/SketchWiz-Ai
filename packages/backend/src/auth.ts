import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const claimsSchema = z.object({
  id: z.number().int().positive(),
  iat: z.number().int().optional(),
  exp: z.number().int().optional(),
  nbf: z.number().int().optional(),
  iss: z.string().optional(),
  aud: z.union([z.string(), z.array(z.string())]).optional(),
});

export type AuthenticatedUser = { id: number };

// Old clients have tokens without exp/iss/aud. Continue accepting those signed
// tokens during the transition; all tokens issued now expire after seven days.
export function verifyAccessToken(
  token: string,
  secret: string,
): AuthenticatedUser | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const header = JSON.parse(
      Buffer.from(parts[0]!, "base64url").toString("utf8"),
    ) as { alg?: string; typ?: string };
    if (
      header.alg !== "HS256" ||
      (header.typ !== undefined && header.typ !== "JWT")
    )
      return null;
    const signature = Buffer.from(parts[2]!, "base64url");
    const expected = createHmac("sha256", secret)
      .update(`${parts[0]}.${parts[1]}`)
      .digest();
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(signature, expected)
    )
      return null;
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    ) as unknown;
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) return null;
    const now = Math.floor(Date.now() / 1000);
    if (claims.data.exp !== undefined && claims.data.exp <= now) return null;
    if (claims.data.nbf !== undefined && claims.data.nbf > now) return null;
    if (claims.data.iat === undefined || claims.data.iat > now + 60)
      return null;
    if (
      claims.data.exp === undefined &&
      now - claims.data.iat > 7 * 24 * 60 * 60
    )
      return null;
    if (claims.data.iss !== undefined && claims.data.iss !== "sketchwiz")
      return null;
    const audiences = Array.isArray(claims.data.aud)
      ? claims.data.aud
      : [claims.data.aud];
    if (claims.data.aud !== undefined && !audiences.includes("sketchwiz-api"))
      return null;
    return { id: claims.data.id };
  } catch {
    return null;
  }
}

export function signAccessToken(id: number, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    id,
    iat: now,
    exp: now + 7 * 24 * 60 * 60,
    iss: "sketchwiz",
    aud: "sketchwiz-api",
  });
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}
