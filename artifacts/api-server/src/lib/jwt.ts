import jwt from "jsonwebtoken";

const JWT_SECRET = process.env["JWT_SECRET"] || "tracktruck-dev-secret-change-in-prod";
const ACCESS_TOKEN_EXPIRES = "15m";
const REFRESH_TOKEN_EXPIRES = "7d";

export interface JwtPayload {
  sub: number;
  email: string;
  type: "access" | "refresh";
}

export function signAccessToken(userId: number, email: string): string {
  return jwt.sign({ sub: userId, email, type: "access" } as JwtPayload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES,
  });
}

export function signRefreshToken(userId: number, email: string): string {
  return jwt.sign({ sub: userId, email, type: "refresh" } as JwtPayload, JWT_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRES,
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
