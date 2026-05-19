import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db, allowedEmailsTable, organizationsTable } from "@workspace/db";
import { validate } from "../middlewares/validate";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth";
import { ROOT_ADMIN_EMAIL } from "../lib/config";

const router: IRouter = Router();

router.use(requireAuth());

/**
 * GET /api/admin/allowed-emails
 */
router.get("/admin/allowed-emails", requireAdmin(), async (req, res) => {
  const allowed = await db.select().from(allowedEmailsTable).orderBy(allowedEmailsTable.createdAt);
  res.json(allowed);
});

/**
 * POST /api/admin/allowed-emails
 */
router.post("/admin/allowed-emails", requireAdmin(), validate({
  body: z.object({
    email: z.string().email(),
    role: z.enum(["super_admin", "admin", "org_admin", "user"]).default("user"),
    name: z.string().optional(),
    isPaid: z.boolean().default(true),
    routeLimit: z.number().int().min(0).default(0),
    organizationId: z.number().int().positive().optional(),
  })
}), async (req, res) => {
  const authUser = (req as AuthRequest).user!;
  const { email, role, isPaid, routeLimit, name, organizationId } = req.body as {
    email: string;
    role: "super_admin" | "admin" | "org_admin" | "user";
    name?: string;
    isPaid: boolean;
    routeLimit: number;
    organizationId?: number;
  };
  const lowerEmail = email.toLowerCase();

  // Admins can add 'user' and 'org_admin' roles. Super admins can add any role.
  if (authUser.role === "admin" && role !== "user" && role !== "org_admin") {
    res.status(403).json({ error: "forbidden", message: "Admins can only authorize client or org admin accounts." });
    return;
  }
  if (authUser.role !== "super_admin" && authUser.role !== "admin" && (role === "super_admin" || role === "admin")) {
    res.status(403).json({ error: "forbidden", message: "Insufficient permissions to assign this role." });
    return;
  }

  // org_admin must be linked to an org
  if (role === "org_admin" && !organizationId) {
    res.status(400).json({ error: "bad_request", message: "org_admin must be linked to an organization. Provide organizationId." });
    return;
  }

  // Validate org exists if provided
  if (organizationId) {
    const [org] = await db.select({ id: organizationsTable.id }).from(organizationsTable).where(eq(organizationsTable.id, organizationId)).limit(1);
    if (!org) {
      res.status(400).json({ error: "bad_request", message: "Organization not found." });
      return;
    }
  }

  const [existing] = await db.select().from(allowedEmailsTable).where(eq(allowedEmailsTable.email, lowerEmail)).limit(1);
  if (existing) {
    res.status(409).json({ error: "conflict", message: "This email is already in the allowed list" });
    return;
  }

  const [newEntry] = await db.insert(allowedEmailsTable).values({
    email: lowerEmail,
    name: name || null,
    role,
    isPaid,
    routeLimit,
    usedRoutes: 0,
    organizationId: organizationId ?? null,
  }).returning();

  res.status(201).json(newEntry);
});

/**
 * PUT /api/admin/allowed-emails/:email
 */
router.put("/admin/allowed-emails/:email", requireAdmin(), validate({
  body: z.object({
    isPaid: z.boolean().optional(),
    routeLimit: z.number().int().positive().optional(),
    usedRoutes: z.number().int().min(0).optional(),
    role: z.enum(["super_admin", "admin", "org_admin", "user"]).optional(),
    name: z.string().optional(),
    organizationId: z.number().int().positive().nullable().optional(),
  })
}), async (req, res) => {
  const email = req.params.email as string;
  const lowerEmail = email.toLowerCase();
  const { isPaid, routeLimit, usedRoutes, role, name, organizationId } = req.body as {
    isPaid?: boolean;
    routeLimit?: number;
    usedRoutes?: number;
    role?: "super_admin" | "admin" | "org_admin" | "user";
    name?: string;
    organizationId?: number | null;
  };

  const [existing] = await db.select().from(allowedEmailsTable).where(eq(allowedEmailsTable.email, lowerEmail)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "not_found", message: "Email not found" });
    return;
  }

  const authUser = (req as AuthRequest).user!;
  if (role && authUser.role !== "super_admin") {
    res.status(403).json({ error: "forbidden", message: "Only root administrators can change account roles." });
    return;
  }

  // Validate org exists if setting organizationId
  if (organizationId != null) {
    const [org] = await db.select({ id: organizationsTable.id }).from(organizationsTable).where(eq(organizationsTable.id, organizationId)).limit(1);
    if (!org) {
      res.status(400).json({ error: "bad_request", message: "Organization not found." });
      return;
    }
  }

  const [updated] = await db.update(allowedEmailsTable)
    .set({
      ...(isPaid !== undefined && { isPaid }),
      ...(name !== undefined && { name }),
      ...(routeLimit !== undefined && { routeLimit }),
      ...(usedRoutes !== undefined && { usedRoutes }),
      ...(role !== undefined && { role }),
      ...(organizationId !== undefined && { organizationId: organizationId ?? null }),
    })
    .where(eq(allowedEmailsTable.email, lowerEmail))
    .returning();

  res.json(updated);
});

/**
 * DELETE /api/admin/allowed-emails/:email
 */
router.delete("/admin/allowed-emails/:email", requireAdmin(), async (req, res) => {
  const email = req.params.email as string;
  const lowerEmail = email.toLowerCase();

  if (ROOT_ADMIN_EMAIL && lowerEmail === ROOT_ADMIN_EMAIL) {
    res.status(403).json({ error: "forbidden", message: "Cannot remove the root super admin" });
    return;
  }

  const authUser = (req as AuthRequest).user!;
  if (lowerEmail === authUser.email.toLowerCase()) {
    res.status(403).json({ error: "forbidden", message: "You cannot remove your own administrator access." });
    return;
  }

  const [deleted] = await db.delete(allowedEmailsTable).where(eq(allowedEmailsTable.email, lowerEmail)).returning();

  if (!deleted) {
    res.status(404).json({ error: "not_found", message: "Email not found in allowed list" });
    return;
  }

  res.json({ message: "Email removed successfully" });
});

// ─── Organization endpoints ──────────────────────────────────────────────────

/**
 * GET /api/admin/organizations
 */
router.get("/admin/organizations", requireAdmin(), async (req, res) => {
  const orgs = await db.select().from(organizationsTable).orderBy(organizationsTable.createdAt);

  const withAllocated = await Promise.all(orgs.map(async (org) => {
    const [{ allocated, used }] = await db
      .select({
        allocated: sql<number>`coalesce(sum(${allowedEmailsTable.routeLimit}), 0)`,
        used: sql<number>`coalesce(sum(${allowedEmailsTable.usedRoutes}), 0)`,
      })
      .from(allowedEmailsTable)
      .where(eq(allowedEmailsTable.organizationId, org.id));
    return { ...org, allocatedRoutes: Number(allocated), usedRoutes: Number(used) };
  }));

  res.json(withAllocated);
});

/**
 * POST /api/admin/organizations
 */
router.post("/admin/organizations", requireAdmin(), validate({
  body: z.object({
    name: z.string().min(1),
    isPaid: z.boolean().default(false),
    routeLimit: z.number().int().min(0).default(0),
  })
}), async (req, res) => {
  const { name, isPaid, routeLimit } = req.body as { name: string; isPaid: boolean; routeLimit: number };

  const [org] = await db.insert(organizationsTable).values({ name, isPaid, routeLimit }).returning();
  res.status(201).json({ ...org, allocatedRoutes: 0, usedRoutes: 0 });
});

/**
 * PUT /api/admin/organizations/:id
 */
router.put("/admin/organizations/:id", requireAdmin(), validate({
  body: z.object({
    name: z.string().min(1).optional(),
    isPaid: z.boolean().optional(),
    routeLimit: z.number().int().min(0).optional(),
  })
}), async (req, res) => {
  const orgId = parseInt(req.params.id as string);
  const { name, isPaid, routeLimit } = req.body as { name?: string; isPaid?: boolean; routeLimit?: number };

  const [existing] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, orgId)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "not_found", message: "Organization not found" });
    return;
  }

  if (routeLimit !== undefined) {
    const [{ allocated }] = await db
      .select({ allocated: sql<number>`coalesce(sum(${allowedEmailsTable.routeLimit}), 0)` })
      .from(allowedEmailsTable)
      .where(eq(allowedEmailsTable.organizationId, orgId));
    if (routeLimit < Number(allocated)) {
      res.status(400).json({ error: "bad_request", message: `Cannot set routeLimit below already-allocated amount (${allocated}).` });
      return;
    }
  }

  const [updated] = await db.update(organizationsTable)
    .set({
      ...(name !== undefined && { name }),
      ...(isPaid !== undefined && { isPaid }),
      ...(routeLimit !== undefined && { routeLimit }),
    })
    .where(eq(organizationsTable.id, orgId))
    .returning();

  const [{ allocated, used }] = await db
    .select({
      allocated: sql<number>`coalesce(sum(${allowedEmailsTable.routeLimit}), 0)`,
      used: sql<number>`coalesce(sum(${allowedEmailsTable.usedRoutes}), 0)`,
    })
    .from(allowedEmailsTable)
    .where(eq(allowedEmailsTable.organizationId, orgId));

  res.json({ ...updated, allocatedRoutes: Number(allocated), usedRoutes: Number(used) });
});

/**
 * DELETE /api/admin/organizations/:id
 */
router.delete("/admin/organizations/:id", requireAdmin(), async (req, res) => {
  const orgId = parseInt(req.params.id as string);

  const [existing] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, orgId)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "not_found", message: "Organization not found" });
    return;
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(allowedEmailsTable)
    .where(eq(allowedEmailsTable.organizationId, orgId));
  if (Number(count) > 0) {
    res.status(400).json({ error: "bad_request", message: "Cannot delete an organization that still has members. Remove all members first." });
    return;
  }

  await db.delete(organizationsTable).where(eq(organizationsTable.id, orgId));
  res.json({ message: "Organization deleted successfully" });
});

export default router;
