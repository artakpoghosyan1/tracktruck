import type { Request, Response, NextFunction, RequestHandler } from "express";
import { verifyToken } from "../lib/jwt";

export interface AuthUser {
  id: number;
  email: string;
  role: string;
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
      authReq.user = { id: payload.sub, email: payload.email, role: payload.role || 'user' };
      // Keep legacy aliases so existing route handlers continue to work
      authReq.userId = payload.sub;
      authReq.userEmail = payload.email;
      next();
    } catch {
      res.status(401).json({ error: "unauthorized", message: "Invalid or expired token" });
    }
  };
}

export function requireSuperAdmin(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthRequest;
    if (authReq.user?.role !== "super_admin") {
      res.status(403).json({ error: "forbidden", message: "Super admin access required" });
      return;
    }
    next();
  };
}

export function requireAdmin(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthRequest;
    if (authReq.user?.role !== "super_admin" && authReq.user?.role !== "admin") {
      res.status(403).json({ error: "forbidden", message: "Admin access required" });
      return;
    }
    next();
  };
}
