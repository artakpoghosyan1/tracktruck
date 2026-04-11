import jwt from "jsonwebtoken";
import crypto from "crypto";

const DEV_SECRET = "tracktruck-dev-secret-change-in-prod";
const JWT_SECRET = (() => {
  const secret = process.env["JWT_SECRET"];
  const isProduction = process.env["NODE_ENV"] === "production";
  if (!secret || secret === DEV_SECRET) {
    if (isProduction) {
      console.error("FATAL: JWT_SECRET is not set or is still the dev placeholder. Set a strong random secret before deploying.");
      process.exit(1);
    }
    console.warn("WARNING: Using insecure dev JWT_SECRET. Set JWT_SECRET in your environment for production.");
    return DEV_SECRET;
  }
  return secret;
})();
const ACCESS_TOKEN_EXPIRES = "15m";
const REFRESH_TOKEN_EXPIRES = "7d";

export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

export interface JwtPayload {
  sub: number;
  email: string;
  role: string;
  type: "access" | "refresh";
  jti?: string; // unique token ID; always present on refresh tokens
}

export function signAccessToken(userId: number, email: string, role: string): string {
  return jwt.sign({ sub: userId, email, role, type: "access" } as JwtPayload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES,
  });
}

export function signRefreshToken(userId: number, email: string, role: string): string {
  return jwt.sign(
    { sub: userId, email, role, type: "refresh", jti: crypto.randomUUID() } as JwtPayload,
    JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRES },
  );
}

export function verifyToken(token: string): JwtPayload {
  return (jwt.verify(token, JWT_SECRET) as any) as JwtPayload;
}

/** SHA-256 hash of a token string for safe DB storage */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
