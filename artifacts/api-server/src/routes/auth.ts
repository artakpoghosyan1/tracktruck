import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { AuthSignupBody, AuthLoginBody, AuthRefreshBody } from "@workspace/api-zod";
import { validate } from "../middlewares/validate";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { signAccessToken, signRefreshToken, verifyToken } from "../lib/jwt";

const router: IRouter = Router();

router.post("/auth/signup", validate({ body: AuthSignupBody }), async (req, res) => {
  const { email, password, name } = req.body as { email: string; password: string; name: string };

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "conflict", message: "An account with this email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usersTable).values({ email, passwordHash, name, emailVerified: false }).returning();

  const accessToken = signAccessToken(user.id, user.email);
  const refreshToken = signRefreshToken(user.id, user.email);

  res.status(201).json({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt.toISOString(),
    },
  });
});

router.post("/auth/login", validate({ body: AuthLoginBody }), async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!user || !user.passwordHash) {
    res.status(401).json({ error: "unauthorized", message: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "unauthorized", message: "Invalid email or password" });
    return;
  }

  const accessToken = signAccessToken(user.id, user.email);
  const refreshToken = signRefreshToken(user.id, user.email);

  res.json({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt.toISOString(),
    },
  });
});

router.post("/auth/google", async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Google OAuth not yet configured" });
});

router.post("/auth/refresh", validate({ body: AuthRefreshBody }), async (req, res) => {
  const { refreshToken } = req.body as { refreshToken: string };

  let payload;
  try {
    payload = verifyToken(refreshToken);
  } catch {
    res.status(401).json({ error: "unauthorized", message: "Invalid or expired refresh token" });
    return;
  }

  if (payload.type !== "refresh") {
    res.status(401).json({ error: "unauthorized", message: "Invalid token type" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.sub)).limit(1);
  if (!user) {
    res.status(401).json({ error: "unauthorized", message: "User not found" });
    return;
  }

  const newAccessToken = signAccessToken(user.id, user.email);
  const newRefreshToken = signRefreshToken(user.id, user.email);

  res.json({
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt.toISOString(),
    },
  });
});

router.post("/auth/logout", (req, res) => {
  res.json({ message: "Logged out successfully" });
});

router.get("/auth/me", requireAuth(), async (req, res) => {
  const authReq = req as AuthRequest;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, authReq.userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "not_found", message: "User not found" });
    return;
  }
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt.toISOString(),
  });
});

export default router;
