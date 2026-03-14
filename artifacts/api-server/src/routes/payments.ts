import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { db, paymentOrdersTable, routesTable, shareLinksTable, simulationStatesTable } from "@workspace/db";
import { CreatePaymentBody, PaymentCallbackBody, GetPaymentParams } from "@workspace/api-zod";
import { validate } from "../middlewares/validate";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

router.post("/payments/create", requireAuth(), validate({ body: CreatePaymentBody }), async (req, res) => {
  const authReq = req as AuthRequest;
  const { routeId, amount, currency = "AMD" } = req.body as {
    routeId: number;
    amount: number;
    currency?: string;
  };

  const [route] = await db
    .select()
    .from(routesTable)
    .where(and(eq(routesTable.id, routeId), eq(routesTable.userId, authReq.userId)))
    .limit(1);

  if (!route) {
    res.status(404).json({ error: "not_found", message: "Route not found" });
    return;
  }

  const paymentReference = `PAY-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

  // Mock payment: auto-mark as paid immediately (real integration would redirect to payment gateway)
  const [payment] = await db
    .insert(paymentOrdersTable)
    .values({
      routeId,
      userId: authReq.userId,
      amount,
      currency,
      status: "paid",
      paymentReference,
      transactionId: `TXN-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
      paidAt: new Date(),
    })
    .returning();

  // Move route to ready
  await db.update(routesTable).set({ status: "ready", updatedAt: new Date() }).where(eq(routesTable.id, routeId));

  // Create a share token
  const token = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  // Deactivate old share links
  await db.update(shareLinksTable).set({ active: false }).where(eq(shareLinksTable.routeId, routeId));

  await db.insert(shareLinksTable).values({ routeId, token, active: true, expiresAt });

  // Create simulation state entry
  const existing = await db.select().from(simulationStatesTable).where(eq(simulationStatesTable.routeId, routeId)).limit(1);
  if (existing.length === 0) {
    await db.insert(simulationStatesTable).values({
      routeId,
      effectiveElapsedMs: 0,
      distanceTraveledM: 0,
      progressPercent: 0,
    });
  } else {
    await db.update(simulationStatesTable)
      .set({ effectiveElapsedMs: 0, distanceTraveledM: 0, progressPercent: 0, startedAt: null, pausedAt: null, updatedAt: new Date() })
      .where(eq(simulationStatesTable.routeId, routeId));
  }

  res.status(201).json({
    id: payment.id,
    routeId: payment.routeId,
    userId: payment.userId,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    paymentReference: payment.paymentReference,
    transactionId: payment.transactionId ?? null,
    approvalUrl: null,
    paidAt: payment.paidAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
  });
});

router.post("/payments/callback", validate({ body: PaymentCallbackBody }), async (req, res) => {
  const { paymentReference, transactionId, status } = req.body as {
    paymentReference: string;
    transactionId: string;
    status: string;
  };

  const [payment] = await db
    .select()
    .from(paymentOrdersTable)
    .where(eq(paymentOrdersTable.paymentReference, paymentReference))
    .limit(1);

  if (!payment) {
    res.status(404).json({ error: "not_found", message: "Payment not found" });
    return;
  }

  const [updated] = await db
    .update(paymentOrdersTable)
    .set({
      status,
      transactionId,
      paidAt: status === "paid" ? new Date() : payment.paidAt,
      updatedAt: new Date(),
    })
    .where(eq(paymentOrdersTable.id, payment.id))
    .returning();

  if (status === "paid") {
    await db.update(routesTable).set({ status: "ready", updatedAt: new Date() }).where(eq(routesTable.id, payment.routeId));
  }

  res.json({ message: "Payment updated", status: updated.status });
});

router.get("/payments/:id", requireAuth(), validate({ params: GetPaymentParams }), async (req, res) => {
  const id = parseInt(req.params["id"]!);
  const authReq = req as AuthRequest;

  const [payment] = await db
    .select()
    .from(paymentOrdersTable)
    .where(and(eq(paymentOrdersTable.id, id), eq(paymentOrdersTable.userId, authReq.userId)))
    .limit(1);

  if (!payment) {
    res.status(404).json({ error: "not_found", message: "Payment not found" });
    return;
  }

  res.json({
    id: payment.id,
    routeId: payment.routeId,
    userId: payment.userId,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    paymentReference: payment.paymentReference,
    transactionId: payment.transactionId ?? null,
    approvalUrl: payment.approvalUrl ?? null,
    paidAt: payment.paidAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
  });
});

export default router;
