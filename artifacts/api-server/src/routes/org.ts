import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq, and, ne, sql } from "drizzle-orm";
import { db, allowedEmailsTable, organizationsTable } from "@workspace/db";
import { validate } from "../middlewares/validate";
import { requireAuth, requireOrgAdmin, type AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

router.use(requireAuth());
router.use(requireOrgAdmin());

/** Resolve org ID for the current user from allowed_emails */
async function getOrgId(email: string): Promise<number | null> {
  const [row] = await db
    .select({ organizationId: allowedEmailsTable.organizationId })
    .from(allowedEmailsTable)
    .where(eq(allowedEmailsTable.email, email))
    .limit(1);
  return row?.organizationId ?? null;
}

/** Remaining quota = org.routeLimit - SUM of member routeLimits (excluding one email) */
async function remainingOrgQuota(orgId: number, excludeEmail?: string): Promise<number> {
  const [org] = await db.select({ routeLimit: organizationsTable.routeLimit }).from(organizationsTable).where(eq(organizationsTable.id, orgId)).limit(1);
  if (!org) return 0;

  const conditions = excludeEmail
    ? and(eq(allowedEmailsTable.organizationId, orgId), ne(allowedEmailsTable.email, excludeEmail))
    : eq(allowedEmailsTable.organizationId, orgId);

  const [{ allocated }] = await db
    .select({ allocated: sql<number>`coalesce(sum(${allowedEmailsTable.routeLimit}), 0)` })
    .from(allowedEmailsTable)
    .where(conditions);

  return org.routeLimit - Number(allocated);
}

/**
 * GET /api/org/users
 * List members of the caller's organization
 */
router.get("/org/users", async (req, res) => {
  const authReq = req as AuthRequest;
  const orgId = await getOrgId(authReq.user.email);
  if (!orgId) {
    res.status(403).json({ error: "forbidden", message: "You are not associated with an organization." });
    return;
  }

  const members = await db
    .select()
    .from(allowedEmailsTable)
    .where(eq(allowedEmailsTable.organizationId, orgId))
    .orderBy(allowedEmailsTable.createdAt);

  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, orgId)).limit(1);
  const [{ allocated }] = await db
    .select({ allocated: sql<number>`coalesce(sum(${allowedEmailsTable.routeLimit}), 0)` })
    .from(allowedEmailsTable)
    .where(eq(allowedEmailsTable.organizationId, orgId));

  res.json({
    organization: org ? { ...org, allocatedRoutes: Number(allocated) } : null,
    members,
  });
});

/**
 * POST /api/org/users
 * Add a user to the organization
 */
router.post("/org/users", validate({
  body: z.object({
    email: z.string().email(),
    name: z.string().optional(),
    routeLimit: z.number().int().min(0).default(0),
  })
}), async (req, res) => {
  const authReq = req as AuthRequest;
  const { email, name, routeLimit } = req.body as { email: string; name?: string; routeLimit: number };
  const lowerEmail = email.toLowerCase();

  const orgId = await getOrgId(authReq.user.email);
  if (!orgId) {
    res.status(403).json({ error: "forbidden", message: "You are not associated with an organization." });
    return;
  }

  const remaining = await remainingOrgQuota(orgId);
  if (routeLimit > remaining) {
    res.status(400).json({ error: "quota_exceeded", message: `Cannot allocate ${routeLimit} routes — only ${remaining} remaining in org quota.` });
    return;
  }

  const [existing] = await db.select({ id: allowedEmailsTable.id }).from(allowedEmailsTable).where(eq(allowedEmailsTable.email, lowerEmail)).limit(1);
  if (existing) {
    res.status(409).json({ error: "conflict", message: "This email is already in the allowed list." });
    return;
  }

  const [newEntry] = await db.insert(allowedEmailsTable).values({
    email: lowerEmail,
    name: name ?? null,
    role: "user",
    isPaid: true,
    routeLimit,
    usedRoutes: 0,
    organizationId: orgId,
  }).returning();

  res.status(201).json(newEntry);
});

/**
 * PUT /api/org/users/:email
 * Update a user's quota allocation
 */
router.put("/org/users/:email", validate({
  body: z.object({
    routeLimit: z.number().int().min(0),
    name: z.string().optional(),
  })
}), async (req, res) => {
  const authReq = req as AuthRequest;
  const targetEmail = (req.params.email as string).toLowerCase();
  const { routeLimit, name } = req.body as { routeLimit: number; name?: string };

  const orgId = await getOrgId(authReq.user.email);
  if (!orgId) {
    res.status(403).json({ error: "forbidden", message: "You are not associated with an organization." });
    return;
  }

  const [member] = await db
    .select()
    .from(allowedEmailsTable)
    .where(and(eq(allowedEmailsTable.email, targetEmail), eq(allowedEmailsTable.organizationId, orgId)))
    .limit(1);

  if (!member) {
    res.status(404).json({ error: "not_found", message: "User not found in your organization." });
    return;
  }

  const remaining = await remainingOrgQuota(orgId, targetEmail);
  if (routeLimit > remaining) {
    res.status(400).json({ error: "quota_exceeded", message: `Cannot allocate ${routeLimit} routes — only ${remaining} remaining in org quota.` });
    return;
  }

  const [updated] = await db.update(allowedEmailsTable)
    .set({
      routeLimit,
      ...(name !== undefined && { name }),
    })
    .where(and(eq(allowedEmailsTable.email, targetEmail), eq(allowedEmailsTable.organizationId, orgId)))
    .returning();

  res.json(updated);
});

/**
 * DELETE /api/org/users/:email
 * Remove a user from the organization
 */
router.delete("/org/users/:email", async (req, res) => {
  const authReq = req as unknown as AuthRequest;
  const targetEmail = (req.params.email as string).toLowerCase();

  if (targetEmail === authReq.user.email.toLowerCase()) {
    res.status(403).json({ error: "forbidden", message: "You cannot remove yourself from the organization." });
    return;
  }

  const orgId = await getOrgId(authReq.user.email);
  if (!orgId) {
    res.status(403).json({ error: "forbidden", message: "You are not associated with an organization." });
    return;
  }

  const [deleted] = await db.delete(allowedEmailsTable)
    .where(and(eq(allowedEmailsTable.email, targetEmail), eq(allowedEmailsTable.organizationId, orgId)))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "not_found", message: "User not found in your organization." });
    return;
  }

  res.json({ message: "User removed from organization." });
});

export default router;
