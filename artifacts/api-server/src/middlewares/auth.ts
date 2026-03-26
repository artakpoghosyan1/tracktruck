import type { Request, Response, NextFunction, RequestHandler } from "express";
import { verifyToken } from "../lib/jwt";

export interface AuthUser {
  id: number;
  email: string;
}

export interface AuthRequest extends Request {
  user: AuthUser;
  /** @deprecated use req.user.id */
  userId: number;
  /** @deprecated use req.user.email */
  userEmail: string;
}

export function requireAuth(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "unauthorized", message: "Missing or invalid Authorization header" });
      return;
    }

    const token = authHeader.slice(7);
    try {
      const payload = verifyToken(token);
      if (payload.type !== "access") {
        res.status(401).json({ error: "unauthorized", message: "Invalid token type" });
        return;
      }
      const authReq = req as AuthRequest;
      authReq.user = { id: payload.sub, email: payload.email };
      // Keep legacy aliases so existing route handlers continue to work
      authReq.userId = payload.sub;
      authReq.userEmail = payload.email;
      next();
    } catch {
      res.status(401).json({ error: "unauthorized", message: "Invalid or expired token" });
    }
  };
}
