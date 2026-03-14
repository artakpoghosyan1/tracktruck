import type { Request, Response, NextFunction, RequestHandler } from "express";
import { verifyToken } from "../lib/jwt";

export interface AuthRequest extends Request {
  userId: number;
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
      (req as AuthRequest).userId = payload.sub;
      (req as AuthRequest).userEmail = payload.email;
      next();
    } catch {
      res.status(401).json({ error: "unauthorized", message: "Invalid or expired token" });
    }
  };
}
