import { Router, type IRouter } from "express";
import { eq, and, isNull } from "drizzle-orm";
import crypto from "crypto";
import { db, routesTable, simulationStatesTable, shareLinksTable, allowedEmailsTable } from "@workspace/db";
import {
  ActivateRouteParams,
  StartRouteParams,
  PauseRouteParams,
  ResumeRouteParams,
  RecalculateRouteParams,
} from "@workspace/api-zod";
import { validate } from "../middlewares/validate";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { totalPolylineDistance } from "../lib/geo";

const router: IRouter = Router();

router.use(requireAuth());

router.post("/routes/:id/activate", validate({ params: ActivateRouteParams }), async (req, res) => {
  const authReq = req as AuthRequest;
  const routeId = parseInt(req.params["id"] as string);

  const [route] = await db
    .select()
    .from(routesTable)
    .where(and(eq(routesTable.id, routeId), eq(routesTable.userId, authReq.userId), isNull(routesTable.deletedAt)))
    .limit(1);

  if (!route) {
    res.status(404).json({ error: "not_found", message: "Route not found" });
    return;
  }

  const nonActivatableStatuses = ["in_progress"];
  if (nonActivatableStatuses.includes(route.status)) {
    res.status(400).json({ error: "bad_request", message: `Route cannot be activated while a simulation is running. Pause or reset it first.` });
    return;
  }

  const polyline = (route.polyline as number[][] | null) ?? [];
  if (polyline.length < 2) {
    res.status(400).json({ error: "bad_request", message: "Route must have at least 2 points on the map before it can be activated." });
    return;
  }

  const [allowed] = await db.select().from(allowedEmailsTable).where(eq(allowedEmailsTable.email, authReq.user.email)).limit(1);
  if (allowed && allowed.role === 'user' && allowed.usedRoutes >= allowed.routeLimit) {
    res.status(403).json({ error: "quota_exceeded", message: "Route limit reached. Upgrade your plan to activate more routes." });
    return;
  }

  // Move route to ready and increment used routes
  await db.transaction(async (tx) => {
    await tx.update(routesTable).set({ status: "ready", updatedAt: new Date() }).where(eq(routesTable.id, routeId));
    if (allowed) {
      await tx.update(allowedEmailsTable)
        .set({ usedRoutes: (allowed.usedRoutes || 0) + 1 })
        .where(eq(allowedEmailsTable.email, authReq.user.email));
    }
  });

  // Create share token
  const token = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.update(shareLinksTable).set({ active: false }).where(eq(shareLinksTable.routeId, routeId));
  await db.insert(shareLinksTable).values({ routeId, token, active: true, expiresAt });

  // Ensure simulation state exists
  const existingSim = await db.select().from(simulationStatesTable).where(eq(simulationStatesTable.routeId, routeId)).limit(1);
  if (existingSim.length === 0) {
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

  res.json({
    routeId,
    status: "ready",
    shareToken: token,
  });
});

router.post("/routes/:id/start", validate({ params: StartRouteParams }), async (req, res) => {
  const authReq = req as AuthRequest;
  const routeId = parseInt(req.params["id"] as string);

  const [route] = await db
    .select()
    .from(routesTable)
    .where(and(eq(routesTable.id, routeId), eq(routesTable.userId, authReq.userId), isNull(routesTable.deletedAt)))
    .limit(1);

  if (!route) {
    res.status(404).json({ error: "not_found", message: "Route not found" });
    return;
  }

  const allowedStartStatuses = ["ready"];
  if (!allowedStartStatuses.includes(route.status)) {
    res.status(400).json({ error: "bad_request", message: `Route cannot be started from status: ${route.status}. Reset it first.` });
    return;
  }

  const now = new Date();
  const isRestart = route.status === "completed";

  await db.update(routesTable).set({ status: "in_progress", updatedAt: now }).where(eq(routesTable.id, routeId));

  if (isRestart) {
    // Re-activate share link if we are restarting a completed route
    await db.update(shareLinksTable).set({ active: true }).where(eq(shareLinksTable.routeId, routeId));
  }

  const existingSim = await db.select().from(simulationStatesTable).where(eq(simulationStatesTable.routeId, routeId)).limit(1);
  if (existingSim.length === 0) {
    await db.insert(simulationStatesTable).values({
      routeId,
      effectiveElapsedMs: 0,
      distanceTraveledM: 0,
      progressPercent: 0,
      startedAt: now,
    });
  } else {
    await db.update(simulationStatesTable)
      .set({
        startedAt: now,
        pausedAt: null,
        updatedAt: now,
        ...(isRestart && {
          effectiveElapsedMs: 0,
          distanceTraveledM: 0,
          progressPercent: 0,
        }),
      })
      .where(eq(simulationStatesTable.routeId, routeId));
  }

  res.json({
    routeId,
    status: "in_progress",
    startedAt: now.toISOString(),
    effectiveElapsedMs: 0,
    distanceTraveledM: 0,
    progressPercent: 0,
  });
});

router.post("/routes/:id/pause", validate({ params: PauseRouteParams }), async (req, res) => {
  const authReq = req as AuthRequest;
  const routeId = parseInt(req.params["id"] as string);

  const [route] = await db
    .select()
    .from(routesTable)
    .where(and(eq(routesTable.id, routeId), eq(routesTable.userId, authReq.userId), isNull(routesTable.deletedAt)))
    .limit(1);

  if (!route || route.status !== "in_progress") {
    res.status(400).json({ error: "bad_request", message: "Route is not in progress" });
    return;
  }

  const [simState] = await db.select().from(simulationStatesTable).where(eq(simulationStatesTable.routeId, routeId)).limit(1);

  const now = new Date();
  const wallElapsedMs = simState?.startedAt ? now.getTime() - simState.startedAt.getTime() : 0;
  const totalElapsedMs = (simState?.effectiveElapsedMs ?? 0) + wallElapsedMs;

  await db.update(routesTable).set({ status: "paused", updatedAt: now }).where(eq(routesTable.id, routeId));
  await db.update(simulationStatesTable)
    .set({ pausedAt: now, startedAt: null, effectiveElapsedMs: totalElapsedMs, updatedAt: now })
    .where(eq(simulationStatesTable.routeId, routeId));

  res.json({ routeId, status: "paused", effectiveElapsedMs: totalElapsedMs });
});

router.post("/routes/:id/resume", validate({ params: ResumeRouteParams }), async (req, res) => {
  const authReq = req as AuthRequest;
  const routeId = parseInt(req.params["id"] as string);

  const [route] = await db
    .select()
    .from(routesTable)
    .where(and(eq(routesTable.id, routeId), eq(routesTable.userId, authReq.userId), isNull(routesTable.deletedAt)))
    .limit(1);

  if (!route || route.status !== "paused") {
    res.status(400).json({ error: "bad_request", message: "Route is not paused" });
    return;
  }

  const now = new Date();
  await db.update(routesTable).set({ status: "in_progress", updatedAt: now }).where(eq(routesTable.id, routeId));
  await db.update(simulationStatesTable)
    .set({ startedAt: now, pausedAt: null, updatedAt: now })
    .where(eq(simulationStatesTable.routeId, routeId));

  res.json({ routeId, status: "in_progress" });
});

router.post("/routes/:id/recalculate", validate({ params: RecalculateRouteParams }), async (req, res) => {
  const authReq = req as AuthRequest;
  const routeId = parseInt(req.params["id"] as string);

  const [route] = await db
    .select()
    .from(routesTable)
    .where(and(eq(routesTable.id, routeId), eq(routesTable.userId, authReq.userId), isNull(routesTable.deletedAt)))
    .limit(1);

  if (!route) {
    res.status(404).json({ error: "not_found", message: "Route not found" });
    return;
  }

  const polyline = (route.polyline as number[][]) || [];
  const distanceM = polyline.length > 1 ? totalPolylineDistance(polyline) : route.distanceM;
  // truckSpeedKmh is used here: distanceM / (kmh * 1000) * 3600 gives seconds
  const estimatedDurationS = route.truckSpeedKmh > 0 ? (distanceM / (route.truckSpeedKmh * 1000)) * 3600 : route.estimatedDurationS;

  await db.update(routesTable)
    .set({ distanceM, estimatedDurationS, updatedAt: new Date() })
    .where(eq(routesTable.id, routeId));

  res.json({ routeId, distanceM, estimatedDurationS });
});

export default router;
