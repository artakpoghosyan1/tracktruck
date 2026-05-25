import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq, and, gt, sql } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";
import rateLimit from "express-rate-limit";
import { db, usersTable, oauthAccountsTable, refreshTokensTable, allowedEmailsTable, organizationsTable } from "@workspace/db";
import type { AllowedEmail } from "@workspace/db";
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
import { ROOT_ADMIN_EMAIL } from "../lib/config";

/** 10 requests per 15 minutes per IP — for credential endpoints (login, signup, google) */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many attempts. Please wait 15 minutes and try again." },
});

/** 20 requests per 15 minutes per IP — for token refresh (less sensitive, but still rate-limit) */
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many token refreshes. Please wait 15 minutes." },
});

const router: IRouter = Router();

// ─── helpers ────────────────────────────────────────────────────────────────

function userPayload(user: {
  id: number;
  email: string;
  name: string;
  emailVerified: boolean;
  role: string;
  organizationId?: number | null;
  createdAt: Date;
  isPaid?: boolean;
  routeLimit?: number;
  usedRoutes?: number;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    role: user.role,
    organizationId: user.organizationId ?? null,
    createdAt: user.createdAt.toISOString(),
    isPaid: user.isPaid ?? true,
    routeLimit: user.routeLimit ?? 25,
    usedRoutes: user.usedRoutes ?? 0,
  };
}

/** Resolve isPaid, routeLimit, usedRoutes, organizationId from an allowed_emails row.
 *  If the row belongs to an org, isPaid comes from the org record. */
async function resolveAllowedData(allowed: AllowedEmail): Promise<{ isPaid: boolean; routeLimit: number; usedRoutes: number; organizationId: number | null }> {
  let isPaid = allowed.isPaid;
  if (allowed.organizationId) {
    const [org] = await db.select({ isPaid: organizationsTable.isPaid })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, allowed.organizationId))
      .limit(1);
    if (org) isPaid = org.isPaid;
  }
  return {
    isPaid,
    routeLimit: allowed.routeLimit,
    usedRoutes: allowed.usedRoutes,
    organizationId: allowed.organizationId ?? null,
  };
}

async function issueTokenPair(userId: number, email: string, role: string) {
  const accessToken = signAccessToken(userId, email, role);
  const refreshToken = signRefreshToken(userId, email, role);

  await db.insert(refreshTokensTable).values({
    userId,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });

  return { accessToken, refreshToken };
}

// ─── routes ─────────────────────────────────────────────────────────────────

router.post("/auth/signup", authLimiter, validate({ body: AuthSignupBody }), async (req, res) => {
  const { email, password, name } = req.body as { email: string; password: string; name: string };
  const lowerEmail = email.toLowerCase();

  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, lowerEmail)).limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "conflict", message: "An account with this email already exists" });
    return;
  }

  let role = "user";
  let allowedData: { isPaid: boolean; routeLimit: number; usedRoutes: number; organizationId: number | null } = { isPaid: true, routeLimit: 25, usedRoutes: 0, organizationId: null };
  if (ROOT_ADMIN_EMAIL && lowerEmail === ROOT_ADMIN_EMAIL) {
    role = "super_admin";
  } else {
    const [allowed] = await db.select().from(allowedEmailsTable).where(eq(allowedEmailsTable.email, lowerEmail)).limit(1);
    if (!allowed) {
      res.status(403).json({ error: "forbidden", message: "This email is not allowed to sign up. Please contact the administrator." });
      return;
    }
    allowedData = await resolveAllowedData(allowed);
    if (!allowedData.isPaid) {
      res.status(402).json({ error: "payment_required", message: "This email is authorized but currently unpaid. Please contact the administrator." });
      return;
    }
    role = allowed.role;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usersTable).values({
    email: lowerEmail,
    passwordHash,
    name,
    emailVerified: false,
    role,
    organizationId: allowedData.organizationId,
  }).returning();

  const { accessToken, refreshToken } = await issueTokenPair(user.id, user.email, user.role);

  res.status(201).json({
    accessToken,
    refreshToken,
    user: userPayload({ ...user, ...allowedData })
  });
});

router.post("/auth/login", authLimiter, validate({ body: AuthLoginBody }), async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  const lowerEmail = email.toLowerCase();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, lowerEmail)).limit(1);
  if (!user || !user.passwordHash) {
    res.status(401).json({ error: "unauthorized", message: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "unauthorized", message: "Invalid email or password" });
    return;
  }

  let allowedData: { isPaid: boolean; routeLimit: number; usedRoutes: number; organizationId: number | null } = { isPaid: true, routeLimit: 25, usedRoutes: 0, organizationId: null };
  if (!ROOT_ADMIN_EMAIL || lowerEmail !== ROOT_ADMIN_EMAIL) {
    const [allowed] = await db.select().from(allowedEmailsTable).where(eq(allowedEmailsTable.email, lowerEmail)).limit(1);
    if (!allowed) {
      res.status(403).json({ error: "forbidden", message: "Your access has been revoked. Please contact the administrator." });
      return;
    }
    allowedData = await resolveAllowedData(allowed);
    if (!allowedData.isPaid) {
      res.status(402).json({ error: "payment_required", message: "Your account is currently unpaid. Please contact the administrator." });
      return;
    }
    // Sync role if it changed in allowed_emails
    if (user.role !== allowed.role) {
      await db.update(usersTable).set({ role: allowed.role }).where(eq(usersTable.id, user.id));
      user.role = allowed.role;
    }
    // Sync organizationId if it changed
    if (user.organizationId !== (allowed.organizationId ?? null)) {
      await db.update(usersTable).set({ organizationId: allowed.organizationId ?? null }).where(eq(usersTable.id, user.id));
      user.organizationId = allowed.organizationId ?? null;
    }
  }

  // Ensure root super admin role is preserved and synced
  if (ROOT_ADMIN_EMAIL && user.email === ROOT_ADMIN_EMAIL && user.role !== "super_admin") {
    await db.update(usersTable).set({ role: "super_admin" }).where(eq(usersTable.id, user.id));
    user.role = "super_admin";
  }

  const { accessToken, refreshToken } = await issueTokenPair(user.id, user.email, user.role);

  res.json({ accessToken, refreshToken, user: userPayload({ ...user, ...allowedData }) });
});

router.post("/auth/google", authLimiter, validate({ body: AuthGoogleBody }), async (req, res) => {
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
    googleEmail = payload["email"]?.toLowerCase();
    googleName = payload["name"] ?? payload["email"];
    googleUserId = payload["sub"];
    googleEmailVerified = payload["email_verified"] === true;
  } catch (err) {
    console.error("Google verifyIdToken error:", err);
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
    user = linked;

    let allowedData: { isPaid: boolean; routeLimit: number; usedRoutes: number; organizationId: number | null } = { isPaid: true, routeLimit: 25, usedRoutes: 0, organizationId: null };
    if (!ROOT_ADMIN_EMAIL || user.email !== ROOT_ADMIN_EMAIL) {
      const [allowed] = await db.select().from(allowedEmailsTable).where(eq(allowedEmailsTable.email, user.email)).limit(1);
      if (!allowed) {
        res.status(403).json({ error: "forbidden", message: "Your access has been revoked. Please contact the administrator." });
        return;
      }
      allowedData = await resolveAllowedData(allowed);
      if (!allowedData.isPaid) {
        res.status(402).json({ error: "payment_required", message: "Your account is currently unpaid. Please contact the administrator." });
        return;
      }
      // Sync role if it changed in allowed_emails
      if (user.role !== allowed.role) {
        await db.update(usersTable).set({ role: allowed.role }).where(eq(usersTable.id, user.id));
        user.role = allowed.role;
      }
      // Sync organizationId if it changed
      if (user.organizationId !== (allowed.organizationId ?? null)) {
        await db.update(usersTable).set({ organizationId: allowed.organizationId ?? null }).where(eq(usersTable.id, user.id));
        user.organizationId = allowed.organizationId ?? null;
      }
    }

    // Safety check: ensure root super admin role is preserved
    if (ROOT_ADMIN_EMAIL && user.email === ROOT_ADMIN_EMAIL && user.role !== "super_admin") {
      await db.update(usersTable).set({ role: "super_admin" }).where(eq(usersTable.id, user.id));
      user.role = "super_admin";
    }

    const { accessToken, refreshToken } = await issueTokenPair(user.id, user.email, user.role);
    res.json({ accessToken, refreshToken, user: userPayload({ ...user, ...allowedData }) });
    return;
  } else {
    // New Google login — find or create user by email, then link the oauth account.
    if (!googleEmailVerified) {
      res.status(401).json({ error: "unauthorized", message: "Google account email is not verified" });
      return;
    }

    let role = "user";
    let orgId: number | null = null;
    if (ROOT_ADMIN_EMAIL && googleEmail === ROOT_ADMIN_EMAIL) {
      role = "super_admin";
    } else {
      const [allowed] = await db.select().from(allowedEmailsTable).where(eq(allowedEmailsTable.email, googleEmail)).limit(1);
      if (!allowed) {
        res.status(403).json({ error: "forbidden", message: "This email is not allowed to log in. Please contact the administrator." });
        return;
      }
      role = allowed.role;
      orgId = allowed.organizationId ?? null;
    }
    const [byEmail] = await db.select().from(usersTable).where(eq(usersTable.email, googleEmail)).limit(1);
    if (byEmail) {
      user = byEmail;
      const updates: Record<string, any> = {};
      if (user.role !== role) updates.role = role;
      if (user.organizationId !== orgId) updates.organizationId = orgId;
      if (Object.keys(updates).length > 0) {
        await db.update(usersTable).set(updates).where(eq(usersTable.id, user.id));
        Object.assign(user, updates);
      }
    } else {
      [user] = await db
        .insert(usersTable)
        .values({ email: googleEmail, name: googleName!, emailVerified: true, role, organizationId: orgId })
        .returning();
    }
    // Race-safe: onConflictDoNothing handles concurrent duplicate inserts gracefully
    await db.insert(oauthAccountsTable).values({
      userId: user.id,
      provider: "google",
      providerUserId: googleUserId,
    }).onConflictDoNothing();
  }

  const { accessToken, refreshToken } = await issueTokenPair(user.id, user.email, user.role);

  const [allowed] = await db.select().from(allowedEmailsTable).where(eq(allowedEmailsTable.email, user.email)).limit(1);
  const allowedRes = allowed
    ? await resolveAllowedData(allowed)
    : { isPaid: true, routeLimit: 25, usedRoutes: 0, organizationId: null };

  res.json({ accessToken, refreshToken, user: userPayload({ ...user, ...allowedRes }) });
});

router.post("/auth/refresh", refreshLimiter, validate({ body: AuthRefreshBody }), async (req, res) => {
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

  await db
    .update(refreshTokensTable)
    .set({ revoked: true })
    .where(eq(refreshTokensTable.id, stored.id));

  const [allowed] = await db.select().from(allowedEmailsTable).where(eq(allowedEmailsTable.email, user.email)).limit(1);
  const allowedRes = allowed
    ? await resolveAllowedData(allowed)
    : { isPaid: true, routeLimit: 25, usedRoutes: 0, organizationId: null };

  const { accessToken: newAccessToken, refreshToken: newRefreshToken } = await issueTokenPair(user.id, user.email, user.role);

  res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken, user: userPayload({ ...user, ...allowedRes }) });
});

router.post("/auth/logout", requireAuth(), async (req, res) => {
  const authReq = req as AuthRequest;
  const body = (req.body ?? {}) as { refreshToken?: string };

  if (body.refreshToken) {
    const tokenHash = hashToken(body.refreshToken);
    await db
      .update(refreshTokensTable)
      .set({ revoked: true })
      .where(and(eq(refreshTokensTable.tokenHash, tokenHash), eq(refreshTokensTable.userId, authReq.user.id)));
  } else {
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

  let allowedData: { isPaid: boolean; routeLimit: number; usedRoutes: number; organizationId: number | null } = { isPaid: true, routeLimit: 25, usedRoutes: 0, organizationId: null };
  if (!ROOT_ADMIN_EMAIL || user.email !== ROOT_ADMIN_EMAIL) {
    const [allowed] = await db.select().from(allowedEmailsTable).where(eq(allowedEmailsTable.email, user.email)).limit(1);
    if (!allowed) {
      res.status(403).json({ error: "forbidden", message: "Your access has been revoked." });
      return;
    }
    allowedData = await resolveAllowedData(allowed);
    if (!allowedData.isPaid) {
      res.status(402).json({ error: "payment_required", message: "Your account is currently unpaid." });
      return;
    }
    // Sync role if it changed in allowed_emails
    if (user.role !== allowed.role) {
      await db.update(usersTable).set({ role: allowed.role }).where(eq(usersTable.id, user.id));
      user.role = allowed.role;
    }
    // Sync organizationId if it changed
    if (user.organizationId !== (allowed.organizationId ?? null)) {
      await db.update(usersTable).set({ organizationId: allowed.organizationId ?? null }).where(eq(usersTable.id, user.id));
      user.organizationId = allowed.organizationId ?? null;
    }
  }

  let orgRemainingRoutes: number | null = null;
  if (user.role === 'org_admin' && allowedData.organizationId) {
    const [org] = await db.select({ routeLimit: organizationsTable.routeLimit }).from(organizationsTable).where(eq(organizationsTable.id, allowedData.organizationId)).limit(1);
    if (org) {
      const [{ allocated }] = await db
        .select({ allocated: sql<number>`coalesce(sum(${allowedEmailsTable.routeLimit}), 0)` })
        .from(allowedEmailsTable)
        .where(eq(allowedEmailsTable.organizationId, allowedData.organizationId));
      orgRemainingRoutes = org.routeLimit - Number(allocated);
    }
  }

  res.json({ ...userPayload({ ...user, ...allowedData }), orgRemainingRoutes });
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
