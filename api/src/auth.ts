import { SignJWT, jwtVerify } from "jose";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createAuth(secret: string) {
  if (secret.length < 32)
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  const key = new TextEncoder().encode(secret);
  return {
    async sign(
      payload: Record<string, string>,
      audience = "participant",
      expiry = "12h",
    ) {
      return new SignJWT(payload)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("snaptiles")
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime(expiry)
        .sign(key);
    },
    async verify(token: string | null, audience = "participant") {
      if (!token)
        throw new ApiError(
          401,
          "Your session is missing. Please join the room again.",
        );
      try {
        return (
          await jwtVerify(token, key, {
            algorithms: ["HS256"],
            issuer: "snaptiles",
            audience,
          })
        ).payload;
      } catch {
        throw new ApiError(
          401,
          "Your session has expired or is invalid. Please join the room again.",
        );
      }
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;

export function organizer(headers: Headers, local: boolean): string {
  if (local) return "local-organizer";
  const encoded = headers.get("x-ms-client-principal");
  if (!encoded || encoded.length > 16_384)
    throw new ApiError(401, "Sign in as an organizer to continue.");
  try {
    const principal = JSON.parse(
      Buffer.from(encoded, "base64").toString("utf8"),
    );
    if (
      typeof principal.userId === "string" &&
      Array.isArray(principal.userRoles) &&
      principal.userRoles.includes("admin")
    ) {
      return principal.userId;
    }
  } catch {
    /* Invalid principals are rejected below. */
  }
  throw new ApiError(403, "An organizer role is required.");
}
