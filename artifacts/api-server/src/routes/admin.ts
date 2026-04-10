import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, allowedEmailsTable } from "@workspace/db";
import { validate } from "../middlewares/validate";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

// Base authentication for all admin routes
router.use(requireAuth());

/**
 * GET /api/admin/allowed-emails
 * List all allowed emails and their roles
 */
router.get("/admin/allowed-emails", requireAdmin(), async (req, res) => {
  const allowed = await db.select().from(allowedEmailsTable).orderBy(allowedEmailsTable.createdAt);
  res.json(allowed);
});

/**
 * POST /api/admin/allowed-emails
 * Add a new email to the allowed list
 */
router.post("/admin/allowed-emails", requireAdmin(), validate({ 
  body: z.object({
    email: z.string().email(),
    role: z.enum(["super_admin", "admin", "user"]).default("user"),
    name: z.string().optional(),
    isPaid: z.boolean().default(true),
    routeLimit: z.number().int().positive().default(25)
  })
}), async (req, res) => {
  const authUser = (req as AuthRequest).user!;
  const { email, role, isPaid, routeLimit, name } = req.body as { 
    email: string; 
    role?: "super_admin" | "admin" | "user";
    name?: string;
    isPaid?: boolean;
    routeLimit?: number;
  };
  const lowerEmail = email.toLowerCase();

  // Role validation: Admins can ONLY add 'user' (Clients). Super Admins can add anyone.
  if (authUser.role === "admin" && role !== "user") {
    res.status(403).json({ error: "forbidden", message: "Admins can only authorize client accounts." });
    return;
  }

  // Check if already exists
  const [existing] = await db.select().from(allowedEmailsTable).where(eq(allowedEmailsTable.email, lowerEmail)).limit(1);
  if (existing) {
    res.status(409).json({ error: "conflict", message: "This email is already in the allowed list" });
    return;
  }

  const [newEntry] = await db.insert(allowedEmailsTable).values({
    email: lowerEmail,
    name: name || null,
    role: role || "user",
    isPaid: isPaid ?? true,
    routeLimit: routeLimit ?? 25,
    usedRoutes: 0,
  }).returning();

  res.status(201).json(newEntry);
});

/**
 * PUT /api/admin/allowed-emails/:email
 * Update settings for an allowed email
 */
router.put("/admin/allowed-emails/:email", requireAdmin(), async (req, res) => {
  const email = req.params.email as string;
  const lowerEmail = email.toLowerCase();
  const { isPaid, routeLimit, usedRoutes, role, name } = req.body as { 
    isPaid?: boolean; 
    routeLimit?: number;
    usedRoutes?: number;
    role?: "super_admin" | "admin" | "user";
    name?: string;
  };

  const [existing] = await db.select().from(allowedEmailsTable).where(eq(allowedEmailsTable.email, lowerEmail)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "not_found", message: "Email not found" });
    return;
  }

  // Super-admin only actions: change role
  const authUser = (req as AuthRequest).user!;
  if (role && authUser.role !== 'super_admin') {
    res.status(403).json({ error: "forbidden", message: "Only root administrators can change account roles." });
    return;
  }

  const [updated] = await db.update(allowedEmailsTable)
    .set({
      ...(isPaid !== undefined && { isPaid }),
      ...(name !== undefined && { name }),
      ...(routeLimit !== undefined && { routeLimit }),
      ...(usedRoutes !== undefined && { usedRoutes }),
      ...(role !== undefined && { role }),
    })
    .where(eq(allowedEmailsTable.email, lowerEmail))
    .returning();

  res.json(updated);
});

/**
 * DELETE /api/admin/allowed-emails/:email
 * Remove an email from the allowed list
 */
router.delete("/admin/allowed-emails/:email", requireAdmin(), async (req, res) => {
  const email = req.params.email as string;
  const lowerEmail = email.toLowerCase();

  if (lowerEmail === "artakpoghosyan1@gmail.com") {
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

export default router;
