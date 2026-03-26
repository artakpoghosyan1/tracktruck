import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq, and, gt } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";
import { db, usersTable, oauthAccountsTable, refreshTokensTable } from "@workspace/db";
import { AuthSignupBody, AuthLoginBody, AuthRefreshBody, AuthGoogleBody, AuthForgotPasswordBody, AuthVerifyEmailBody } from "@workspace/api-zod";
import { validate } from "../middlewares/validate";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import {
  signAccessToken,
  signRefreshToken,
  verifyToken,
  hashToken,
  REFRESH_TOKEN_TTL_MS,
} from "../lib/jwt";

const router: IRouter = Router();

// ─── helpers ────────────────────────────────────────────────────────────────

function userPayload(user: { id: number; email: string; name: string; emailVerified: boolean; createdAt: Date }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt.toISOString(),
  };
}

async function issueTokenPair(userId: number, email: string) {
  const accessToken = signAccessToken(userId, email);
  const refreshToken = signRefreshToken(userId, email);

  await db.insert(refreshTokensTable).values({
    userId,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });

  return { accessToken, refreshToken };
}

// ─── routes ─────────────────────────────────────────────────────────────────

router.post("/auth/signup", validate({ body: AuthSignupBody }), async (req, res) => {
  const { email, password, name } = req.body as { email: string; password: string; name: string };

  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "conflict", message: "An account with this email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usersTable).values({ email, passwordHash, name, emailVerified: false }).returning();

  const { accessToken, refreshToken } = await issueTokenPair(user.id, user.email);

  res.status(201).json({ accessToken, refreshToken, user: userPayload(user) });
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

  const { accessToken, refreshToken } = await issueTokenPair(user.id, user.email);

  res.json({ accessToken, refreshToken, user: userPayload(user) });
});

router.post("/auth/google", validate({ body: AuthGoogleBody }), async (req, res) => {
  const googleClientId = process.env["GOOGLE_CLIENT_ID"];
  if (!googleClientId) {
    res.status(503).json({
      error: "service_unavailable",
      message: "Google OAuth is not configured. Set the GOOGLE_CLIENT_ID environment variable to enable it.",
    });
    return;
  }

  const { idToken } = req.body as { idToken: string };

  let googleEmail: string | undefined;
  let googleName: string | undefined;
  let googleUserId: string | undefined;
  let googleEmailVerified = false;

  try {
    const client = new OAuth2Client(googleClientId);
    const ticket = await client.verifyIdToken({ idToken, audience: googleClientId });
    const payload = ticket.getPayload();
    if (!payload) throw new Error("Empty Google token payload");
    googleEmail = payload["email"];
    googleName = payload["name"] ?? payload["email"];
    googleUserId = payload["sub"];
    googleEmailVerified = payload["email_verified"] === true;
  } catch {
    res.status(401).json({ error: "unauthorized", message: "Invalid Google ID token" });
    return;
  }

  if (!googleEmail || !googleUserId) {
    res.status(401).json({ error: "unauthorized", message: "Google token missing required fields" });
    return;
  }

  // Resolve identity: provider ID is the canonical key to avoid identity drift if email changes.
  // 1. Look for an existing oauth_accounts row linking this Google account.
  const [existingOAuth] = await db
    .select()
    .from(oauthAccountsTable)
    .where(
      and(
        eq(oauthAccountsTable.provider, "google"),
        eq(oauthAccountsTable.providerUserId, googleUserId),
      ),
    )
    .limit(1);

  let user;
  if (existingOAuth) {
    // Known Google account — load the linked local user
    const [linked] = await db.select().from(usersTable).where(eq(usersTable.id, existingOAuth.userId)).limit(1);
    if (!linked) {
      res.status(500).json({ error: "internal_error", message: "Linked user account not found" });
      return;
    }
    user = linked;
  } else {
    // New Google login — find or create user by email, then link the oauth account.
    // Only link by email when Google has verified the address (prevents account takeover).
    if (!googleEmailVerified) {
      res.status(401).json({ error: "unauthorized", message: "Google account email is not verified" });
      return;
    }
    const [byEmail] = await db.select().from(usersTable).where(eq(usersTable.email, googleEmail)).limit(1);
    if (byEmail) {
      user = byEmail;
    } else {
      [user] = await db
        .insert(usersTable)
        .values({ email: googleEmail, name: googleName!, emailVerified: true })
        .returning();
    }
    // Race-safe: onConflictDoNothing handles concurrent duplicate inserts gracefully
    await db.insert(oauthAccountsTable).values({
      userId: user.id,
      provider: "google",
      providerUserId: googleUserId,
    }).onConflictDoNothing();
  }

  const { accessToken, refreshToken } = await issueTokenPair(user.id, user.email);

  res.json({ accessToken, refreshToken, user: userPayload(user) });
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

  // Verify token exists in DB, is not revoked, and has not expired at DB level
  const tokenHash = hashToken(refreshToken);
  const [stored] = await db
    .select()
    .from(refreshTokensTable)
    .where(
      and(
        eq(refreshTokensTable.tokenHash, tokenHash),
        eq(refreshTokensTable.revoked, false),
        gt(refreshTokensTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!stored) {
    res.status(401).json({ error: "unauthorized", message: "Refresh token has been revoked, expired, or does not exist" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.sub)).limit(1);
  if (!user) {
    res.status(401).json({ error: "unauthorized", message: "User not found" });
    return;
  }

  // Rotate: revoke old token, issue new pair
  await db
    .update(refreshTokensTable)
    .set({ revoked: true })
    .where(eq(refreshTokensTable.id, stored.id));

  const { accessToken: newAccessToken, refreshToken: newRefreshToken } = await issueTokenPair(user.id, user.email);

  res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken, user: userPayload(user) });
});

router.post("/auth/logout", requireAuth(), async (req, res) => {
  const authReq = req as AuthRequest;
  const body = (req.body ?? {}) as { refreshToken?: string };

  if (body.refreshToken) {
    // Revoke the specific refresh token provided
    const tokenHash = hashToken(body.refreshToken);
    await db
      .update(refreshTokensTable)
      .set({ revoked: true })
      .where(and(eq(refreshTokensTable.tokenHash, tokenHash), eq(refreshTokensTable.userId, authReq.user.id)));
  } else {
    // No specific token — revoke all active refresh tokens for this user (full session invalidation)
    await db
      .update(refreshTokensTable)
      .set({ revoked: true })
      .where(and(eq(refreshTokensTable.userId, authReq.user.id), eq(refreshTokensTable.revoked, false)));
  }

  res.json({ message: "Logged out successfully" });
});

router.get("/auth/me", requireAuth(), async (req, res) => {
  const authReq = req as AuthRequest;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, authReq.userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "not_found", message: "User not found" });
    return;
  }
  res.json(userPayload(user));
});

// Stub: password reset — email sending not yet implemented
router.post("/auth/forgot-password", validate({ body: AuthForgotPasswordBody }), async (req, res) => {
  res.status(501).json({
    error: "not_implemented",
    message: "Password reset emails are not yet configured. Please contact support.",
  });
});

// Stub: email verification — token validation not yet implemented
router.post("/auth/verify-email", validate({ body: AuthVerifyEmailBody }), async (req, res) => {
  res.status(501).json({
    error: "not_implemented",
    message: "Email verification is not yet configured.",
  });
});

export default router;
