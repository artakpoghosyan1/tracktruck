import { Router, type IRouter } from "express";
import { eq, and, ilike, desc, asc, isNull, sql, count } from "drizzle-orm";
import { db, routesTable, routeStopsTable, shareLinksTable, simulationStatesTable } from "@workspace/db";
import { broadcastToToken, broadcastToRoute } from "./ws";
import {
  ListRoutesQueryParams,
  CreateRouteBody,
  GetRouteParams,
  UpdateRouteParams,
  UpdateRouteBody,
  DeleteRouteParams,
  CreateStopParams,
  CreateStopBody,
  UpdateStopParams,
  UpdateStopBody,
  DeleteStopParams,
} from "@workspace/api-zod";
import { validate } from "../middlewares/validate";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

router.use(requireAuth());

router.get("/routes", validate({ query: ListRoutesQueryParams }), async (req, res) => {
  const authReq = req as AuthRequest;
  const { page = 1, page_size = 10, status, search, sort = "newest" } = req.query as {
    page?: number;
    page_size?: number;
    status?: string;
    search?: string;
    sort?: string;
  };

  const pageNum = Number(page);
  const pageSize = Number(page_size);
  const offset = (pageNum - 1) * pageSize;

  const conditions = [
    eq(routesTable.userId, authReq.userId),
    isNull(routesTable.deletedAt),
    ...(status ? [eq(routesTable.status, status)] : []),
    ...(search ? [ilike(routesTable.name, `%${search}%`)] : []),
  ];

  const whereClause = and(...conditions);
  const orderClause = sort === "oldest" ? asc(routesTable.createdAt) : desc(routesTable.createdAt);

  const [totalResult, routes] = await Promise.all([
    db.select({ count: count() }).from(routesTable).where(whereClause),
    db.select().from(routesTable).where(whereClause).orderBy(orderClause).limit(pageSize).offset(offset),
  ]);

  const total = totalResult[0]?.count ?? 0;

  const routeIds = routes.map((r) => r.id);

  const [shareLinks] =
    routeIds.length > 0
      ? await Promise.all([
          db.select().from(shareLinksTable).where(
            and(
              sql`${shareLinksTable.routeId} = ANY(${sql`ARRAY[${sql.join(routeIds.map((id) => sql`${id}`), sql`, `)}]::int[]`})`,
              eq(shareLinksTable.active, true),
            ),
          ),
        ])
      : [[]];

  const shareMap = new Map(shareLinks.map((sl) => [sl.routeId, sl]));

  const data = routes.map((r) => {
    const shareLink = shareMap.get(r.id);
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      startLat: r.startLat,
      startLng: r.startLng,
      endLat: r.endLat,
      endLng: r.endLng,
      truckSpeedKmh: r.truckSpeedKmh,
      shareToken: shareLink?.token ?? null,
      shareLinkActive: shareLink?.active ?? false,
      updateCount: r.updateCount,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });

  res.json({ data, total, page: pageNum, pageSize });
});

router.post("/routes", validate({ body: CreateRouteBody }), async (req, res) => {
  const authReq = req as AuthRequest;
  const { name, startLat, startLng, endLat, endLng, truckSpeedKmh = 60, polyline = [], speedProfile = [], customDurationS } = req.body as {
    name: string;
    startLat: number;
    startLng: number;
    endLat: number;
    endLng: number;
    truckSpeedKmh?: number;
    polyline?: number[][];
    speedProfile?: { distanceM: number; speedKmh: number }[];
    customDurationS?: number | null;
  };

  const { totalPolylineDistance } = await import("../lib/geo");
  const distanceM = polyline.length > 1 ? totalPolylineDistance(polyline) : 0;

  let estimatedDurationS = truckSpeedKmh > 0 ? (distanceM / 1000 / truckSpeedKmh) * 3600 : 0;
  if (speedProfile.length > 0) {
    let dur = 0;
    let profDist = 0;
    for (const seg of speedProfile) {
      if (seg.speedKmh > 0 && seg.distanceM > 0) {
        dur += seg.distanceM / (seg.speedKmh * 1000 / 3600);
        profDist += seg.distanceM;
      }
    }
    const remaining = distanceM - profDist;
    if (remaining > 0 && truckSpeedKmh > 0) {
      dur += remaining / (truckSpeedKmh * 1000 / 3600);
    }
    estimatedDurationS = dur;
  }

  const [route] = await db
    .insert(routesTable)
    .values({
      userId: authReq.userId,
      name,
      startLat,
      startLng,
      endLat,
      endLng,
      truckSpeedKmh,
      polyline,
      speedProfile,
      distanceM,
      estimatedDurationS,
      customDurationS: customDurationS ?? null,
      status: "draft",
    })
    .returning();

  res.status(201).json({
    id: route.id,
    name: route.name,
    status: route.status,
    startLat: route.startLat,
    startLng: route.startLng,
    endLat: route.endLat,
    endLng: route.endLng,
    truckSpeedKmh: route.truckSpeedKmh,
    polyline: route.polyline,
    speedProfile: route.speedProfile,
    distanceM: route.distanceM,
    estimatedDurationS: route.estimatedDurationS,
    shareToken: null,
    shareLinkActive: false,
    stops: [],
    createdAt: route.createdAt.toISOString(),
    updatedAt: route.updatedAt.toISOString(),
  });
});

router.get("/routes/:id", validate({ params: GetRouteParams }), async (req, res) => {
  const authReq = req as AuthRequest;
  const id = parseInt(req.params["id"] as string);

  const [route] = await db
    .select()
    .from(routesTable)
    .where(and(eq(routesTable.id, id), eq(routesTable.userId, authReq.userId), isNull(routesTable.deletedAt)))
    .limit(1);

  if (!route) {
    res.status(404).json({ error: "not_found", message: "Route not found" });
    return;
  }

  const [stops, shareLinks] = await Promise.all([
    db.select().from(routeStopsTable).where(eq(routeStopsTable.routeId, id)).orderBy(asc(routeStopsTable.sortOrder)),
    db.select().from(shareLinksTable).where(and(eq(shareLinksTable.routeId, id), eq(shareLinksTable.active, true))).limit(1),
  ]);

  const shareLink = shareLinks[0];

  res.json({
    id: route.id,
    name: route.name,
    status: route.status,
    startLat: route.startLat,
    startLng: route.startLng,
    endLat: route.endLat,
    endLng: route.endLng,
    truckSpeedKmh: route.truckSpeedKmh,
    polyline: route.polyline,
    speedProfile: route.speedProfile,
    distanceM: route.distanceM,
    estimatedDurationS: route.estimatedDurationS,
    shareToken: shareLink?.token ?? null,
    shareLinkActive: shareLink?.active ?? false,
    lastActivationDate: null,
    stops: stops.map((s) => ({
      id: s.id,
      routeId: s.routeId,
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      durationMinutes: s.durationMinutes,
      sortOrder: s.sortOrder,
      createdAt: s.createdAt.toISOString(),
    })),
    updateCount: route.updateCount,
    customDurationS: route.customDurationS,
    customDurationEnabled: route.customDurationEnabled,
    showSpeedPublic: route.showSpeedPublic,
    createdAt: route.createdAt.toISOString(),
    updatedAt: route.updatedAt.toISOString(),
  });
});

router.put("/routes/:id", validate({ params: UpdateRouteParams, body: UpdateRouteBody }), async (req, res) => {
  const authReq = req as AuthRequest;
  const id = parseInt(req.params["id"] as string);

  const [existing] = await db
    .select()
    .from(routesTable)
    .where(and(eq(routesTable.id, id), eq(routesTable.userId, authReq.userId), isNull(routesTable.deletedAt)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "not_found", message: "Route not found" });
    return;
  }

  if (existing.status === "completed") {
    res.status(400).json({ error: "bad_request", message: "Route is completed and cannot be edited. Reset it first." });
    return;
  }

  // Single update limit for clients on STARTED routes (in_progress or paused)
  const isStarted = ["in_progress", "paused"].includes(existing.status);
  if (isStarted && authReq.user?.role === "user" && (existing.updateCount || 0) >= 1) {
    res.status(403).json({ 
      error: "forbidden", 
      message: "This route has already been modified once while in progress. Further changes are restricted. Please contact an administrator." 
    });
    return;
  }

  const { name, startLat, startLng, endLat, endLng, truckSpeedKmh, polyline, speedProfile, customDurationS } = req.body as {
    name?: string;
    startLat?: number;
    startLng?: number;
    endLat?: number;
    endLng?: number;
    truckSpeedKmh?: number;
    polyline?: number[][];
    speedProfile?: { distanceM: number; speedKmh: number }[];
    customDurationS?: number | null;
  };

  const newPolyline = polyline ?? existing.polyline ?? [];
  const newSpeed = truckSpeedKmh ?? existing.truckSpeedKmh;
  const newSpeedProfile = speedProfile ?? (existing.speedProfile as { distanceM: number; speedKmh: number }[] | null) ?? [];
  const { totalPolylineDistance } = await import("../lib/geo");
  const distanceM = newPolyline.length > 1 ? totalPolylineDistance(newPolyline) : existing.distanceM;

  let estimatedDurationS = newSpeed > 0 ? (distanceM / 1000 / newSpeed) * 3600 : existing.estimatedDurationS;
  if (newSpeedProfile.length > 0) {
    let dur = 0;
    let profDist = 0;
    for (const seg of newSpeedProfile) {
      if (seg.speedKmh > 0 && seg.distanceM > 0) {
        dur += seg.distanceM / (seg.speedKmh * 1000 / 3600);
        profDist += seg.distanceM;
      }
    }
    const remaining = distanceM - profDist;
    if (remaining > 0 && newSpeed > 0) {
      dur += remaining / (newSpeed * 1000 / 3600);
    }
    estimatedDurationS = dur;
  }

    const hasPointChanges = 
      (startLat !== undefined && startLat !== existing.startLat) ||
      (startLng !== undefined && startLng !== existing.startLng) ||
      (endLat !== undefined && endLat !== existing.endLat) ||
      (endLng !== undefined && endLng !== existing.endLng);
    
    // Stringify polyline for deep comparison check if provided
    const polylineChanged = polyline !== undefined && JSON.stringify(polyline) !== JSON.stringify(existing.polyline);
    const nameChanged = name !== undefined && name !== existing.name;
    const speedChanged = truckSpeedKmh !== undefined && truckSpeedKmh !== existing.truckSpeedKmh;
    const durationChanged = customDurationS !== undefined && customDurationS !== existing.customDurationS;

    const anythingChanged = hasPointChanges || polylineChanged || nameChanged || speedChanged || durationChanged;

    const [updated] = await db
      .update(routesTable)
      .set({
        ...(name !== undefined && { name }),
        ...(startLat !== undefined && { startLat }),
        ...(startLng !== undefined && { startLng }),
        ...(endLat !== undefined && { endLat }),
        ...(endLng !== undefined && { endLng }),
        ...(truckSpeedKmh !== undefined && { truckSpeedKmh }),
        ...(polyline !== undefined && { polyline }),
        ...(speedProfile !== undefined && { speedProfile }),
        ...(customDurationS !== undefined && { customDurationS: customDurationS ?? null }),
        distanceM,
        estimatedDurationS,
        updatedAt: new Date(),
        ...(isStarted && anythingChanged && { updateCount: (existing.updateCount || 0) + 1 }),
      })
      .where(eq(routesTable.id, id))
      .returning();

  // If route is activated, check if the route geometry changed and reset simulation
  if (["ready", "in_progress", "paused"].includes(updated.status)) {
    const routeGeometryChanged =
      (startLat !== undefined && startLat !== existing.startLat) ||
      (startLng !== undefined && startLng !== existing.startLng) ||
      (endLat !== undefined && endLat !== existing.endLat) ||
      (endLng !== undefined && endLng !== existing.endLng) ||
      polyline !== undefined;

    if (routeGeometryChanged) {
      // Reset simulation state so the truck starts from the new start point
      await db.update(simulationStatesTable)
        .set({
          effectiveElapsedMs: 0,
          distanceTraveledM: 0,
          progressPercent: 0,
          startedAt: updated.status === "in_progress" ? new Date() : null,
          pausedAt: updated.status === "paused" ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(simulationStatesTable.routeId, updated.id));
    }

    // Notify all viewers that the route has changed so they refetch
    const routeUpdatedMsg = { type: "route_updated", routeId: updated.id };
    broadcastToRoute(updated.id, routeUpdatedMsg);
    // Also broadcast to public share-link channels
    const activeLinks = await db
      .select()
      .from(shareLinksTable)
      .where(and(eq(shareLinksTable.routeId, updated.id), eq(shareLinksTable.active, true)));
    for (const sl of activeLinks) {
      broadcastToToken(sl.token, routeUpdatedMsg);
    }
  }

  // Re-fetch the active share link so the response reflects the real state
  const [updatedShareLink] = await db
    .select()
    .from(shareLinksTable)
    .where(and(eq(shareLinksTable.routeId, updated.id), eq(shareLinksTable.active, true)))
    .limit(1);

  res.json({
    id: updated.id,
    name: updated.name,
    status: updated.status,
    startLat: updated.startLat,
    startLng: updated.startLng,
    endLat: updated.endLat,
    endLng: updated.endLng,
    truckSpeedKmh: updated.truckSpeedKmh,
    polyline: updated.polyline,
    speedProfile: updated.speedProfile,
    distanceM: updated.distanceM,
    estimatedDurationS: updated.estimatedDurationS,
    shareToken: updatedShareLink?.token ?? null,
    shareLinkActive: updatedShareLink?.active ?? false,
    stops: [],
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

router.delete("/routes/:id", validate({ params: DeleteRouteParams }), async (req, res) => {
  const authReq = req as AuthRequest;
  const id = parseInt(req.params["id"] as string);

  const [existing] = await db
    .select()
    .from(routesTable)
    .where(and(eq(routesTable.id, id), eq(routesTable.userId, authReq.userId), isNull(routesTable.deletedAt)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "not_found", message: "Route not found" });
    return;
  }

  await db.update(routesTable).set({ deletedAt: new Date() }).where(eq(routesTable.id, id));

  res.status(204).send();
});

// Dedicated speed-only update — does NOT count as a route change, unlimited for all users
router.patch("/routes/:id/speed", async (req, res) => {
  const authReq = req as unknown as AuthRequest;
  const id = parseInt(req.params["id"] as string);

  const [existing] = await db
    .select()
    .from(routesTable)
    .where(and(eq(routesTable.id, id), eq(routesTable.userId, authReq.userId), isNull(routesTable.deletedAt)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "not_found", message: "Route not found" });
    return;
  }

  const { truckSpeedKmh, customDurationS, customDurationEnabled, showSpeedPublic } = req.body as {
    truckSpeedKmh?: number;
    customDurationS?: number | null;
    customDurationEnabled?: boolean;
    showSpeedPublic?: boolean;
  };

  const newSpeed = truckSpeedKmh ?? existing.truckSpeedKmh;
  const newPolyline = existing.polyline ?? [];
  const newSpeedProfile = (existing.speedProfile as { distanceM: number; speedKmh: number }[] | null) ?? [];
  const { totalPolylineDistance } = await import("../lib/geo");
  const distanceM = (newPolyline as number[][]).length > 1 ? totalPolylineDistance(newPolyline as number[][]) : existing.distanceM;

  let estimatedDurationS = newSpeed > 0 ? (distanceM / 1000 / newSpeed) * 3600 : existing.estimatedDurationS;
  if (newSpeedProfile.length > 0) {
    let dur = 0;
    let profDist = 0;
    for (const seg of newSpeedProfile) {
      if (seg.speedKmh > 0 && seg.distanceM > 0) {
        dur += seg.distanceM / (seg.speedKmh * 1000 / 3600);
        profDist += seg.distanceM;
      }
    }
    const remaining = distanceM - profDist;
    if (remaining > 0 && newSpeed > 0) {
      dur += remaining / (newSpeed * 1000 / 3600);
    }
    estimatedDurationS = dur;
  }

  const [updated] = await db
    .update(routesTable)
    .set({
      ...(truckSpeedKmh !== undefined && { truckSpeedKmh }),
      ...(customDurationS !== undefined && { customDurationS }),
      ...(customDurationEnabled !== undefined && { customDurationEnabled }),
      ...(showSpeedPublic !== undefined && { showSpeedPublic }),
      distanceM,
      estimatedDurationS,
      updatedAt: new Date(),
      // NOTE: updateCount is NOT incremented — speed changes are unlimited
    })
    .where(eq(routesTable.id, id))
    .returning();

  // When speed/duration settings change on a LIVE route: recalculate
  // effectiveElapsedMs so the truck stays at its current position instead of
  // jumping.  The simulation engine computes:
  //   virtualElapsedS = totalElapsedS × speedMultiplier
  // We need:  oldTotal × oldMult  =  newTotal × newMult
  //   →  newTotal = oldTotal × (oldMult / newMult)
  if (["in_progress", "paused"].includes(updated.status)) {
    const [simState] = await db.select().from(simulationStatesTable)
      .where(eq(simulationStatesTable.routeId, id)).limit(1);

    if (simState) {
      // Calculate current total elapsed milliseconds
      let totalElapsedMs = simState.effectiveElapsedMs ?? 0;
      if (updated.status === "in_progress" && simState.startedAt) {
        totalElapsedMs += Date.now() - simState.startedAt.getTime();
      }

      // Fetch stops so we can compute naturalTimeS accurately
      const dbStops = await db.select().from(routeStopsTable)
        .where(eq(routeStopsTable.routeId, id));
      const totalStopWaitS = dbStops.reduce((sum, s) => sum + s.durationMinutes * 60, 0);
      const naturalTimeS = updated.estimatedDurationS + totalStopWaitS;

      // Old multiplier (what was active BEFORE this update)
      const oldEnabled = existing.customDurationEnabled;
      const oldDuration = existing.customDurationS;
      const oldMult = (oldEnabled && oldDuration && oldDuration > 0 && naturalTimeS > 0)
        ? naturalTimeS / oldDuration
        : 1.0;

      // New multiplier (what is now active AFTER this update)
      const newEnabled = updated.customDurationEnabled;
      const newDuration = updated.customDurationS;
      const newMult = (newEnabled && newDuration && newDuration > 0 && naturalTimeS > 0)
        ? naturalTimeS / newDuration
        : 1.0;

      // Adjust elapsed time so truck stays at the same position
      const adjustedMs = Math.round(totalElapsedMs * (oldMult / newMult));

      await db.update(simulationStatesTable)
        .set({
          effectiveElapsedMs: adjustedMs,
          startedAt: updated.status === "in_progress" ? new Date() : simState.startedAt,
          updatedAt: new Date(),
        })
        .where(eq(simulationStatesTable.routeId, id));
    }
  }

  // Always notify viewers so public pages pick up showSpeedPublic changes
  const routeUpdatedMsg = { type: "route_updated", routeId: updated.id };
  broadcastToRoute(updated.id, routeUpdatedMsg);
  const activeLinks = await db
    .select()
    .from(shareLinksTable)
    .where(and(eq(shareLinksTable.routeId, updated.id), eq(shareLinksTable.active, true)));
  for (const sl of activeLinks) {
    broadcastToToken(sl.token, routeUpdatedMsg);
  }

  res.json({
    id: updated.id,
    truckSpeedKmh: updated.truckSpeedKmh,
    customDurationS: updated.customDurationS,
    customDurationEnabled: updated.customDurationEnabled,
    showSpeedPublic: updated.showSpeedPublic,
    estimatedDurationS: updated.estimatedDurationS,
    distanceM: updated.distanceM,
  });
});

router.post("/routes/:id/stops", validate({ params: CreateStopParams, body: CreateStopBody }), async (req, res) => {
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

  if (route.status === "completed") {
    res.status(400).json({ error: "bad_request", message: "Route is completed and stops cannot be modified. Reset it first." });
    return;
  }

  const { name, lat, lng, durationMinutes = 5, sortOrder = 0 } = req.body as {
    name: string;
    lat: number;
    lng: number;
    durationMinutes?: number;
    sortOrder?: number;
  };

  const [stop] = await db
    .insert(routeStopsTable)
    .values({ routeId, name, lat, lng, durationMinutes, sortOrder })
    .returning();

  // Notify live viewers so position recalculates with the new stop
  if (["in_progress", "paused"].includes(route.status)) {
    const routeUpdatedMsg = { type: "route_updated", routeId: route.id };
    broadcastToRoute(route.id, routeUpdatedMsg);
    const activeLinks = await db
      .select()
      .from(shareLinksTable)
      .where(and(eq(shareLinksTable.routeId, route.id), eq(shareLinksTable.active, true)));
    for (const sl of activeLinks) {
      broadcastToToken(sl.token, routeUpdatedMsg);
    }
  }

  res.status(201).json({
    id: stop.id,
    routeId: stop.routeId,
    name: stop.name,
    lat: stop.lat,
    lng: stop.lng,
    durationMinutes: stop.durationMinutes,
    sortOrder: stop.sortOrder,
    createdAt: stop.createdAt.toISOString(),
  });
});

router.put(
  "/routes/:id/stops/:stopId",
  validate({ params: UpdateStopParams, body: UpdateStopBody }),
  async (req, res) => {
    const authReq = req as AuthRequest;
    const routeId = parseInt(req.params["id"] as string);
    const stopId = parseInt(req.params["stopId"] as string);

    const [route] = await db
      .select()
      .from(routesTable)
      .where(and(eq(routesTable.id, routeId), eq(routesTable.userId, authReq.userId), isNull(routesTable.deletedAt)))
      .limit(1);

    if (!route) {
      res.status(404).json({ error: "not_found", message: "Route not found" });
      return;
    }

    if (route.status === "completed") {
      res.status(400).json({ error: "bad_request", message: "Route is completed and stops cannot be modified. Reset it first." });
      return;
    }


    const { name, lat, lng, durationMinutes, sortOrder } = req.body as {
      name?: string;
      lat?: number;
      lng?: number;
      durationMinutes?: number;
      sortOrder?: number;
    };

    const [updated] = await db
      .update(routeStopsTable)
      .set({
        ...(name !== undefined && { name }),
        ...(lat !== undefined && { lat }),
        ...(lng !== undefined && { lng }),
        ...(durationMinutes !== undefined && { durationMinutes }),
        ...(sortOrder !== undefined && { sortOrder }),
      })
      .where(and(eq(routeStopsTable.id, stopId), eq(routeStopsTable.routeId, routeId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "not_found", message: "Stop not found" });
      return;
    }

    // Notify live viewers so position recalculates with new stop settings
    if (["in_progress", "paused"].includes(route.status)) {
      const routeUpdatedMsg = { type: "route_updated", routeId: route.id };
      broadcastToRoute(route.id, routeUpdatedMsg);
      const activeLinks = await db
        .select()
        .from(shareLinksTable)
        .where(and(eq(shareLinksTable.routeId, route.id), eq(shareLinksTable.active, true)));
      for (const sl of activeLinks) {
        broadcastToToken(sl.token, routeUpdatedMsg);
      }
    }

    res.json({
      id: updated.id,
      routeId: updated.routeId,
      name: updated.name,
      lat: updated.lat,
      lng: updated.lng,
      durationMinutes: updated.durationMinutes,
      sortOrder: updated.sortOrder,
      createdAt: updated.createdAt.toISOString(),
    });
  },
);

router.delete("/routes/:id/stops/:stopId", validate({ params: DeleteStopParams }), async (req, res) => {
  const authReq = req as AuthRequest;
  const routeId = parseInt(req.params["id"] as string);
  const stopId = parseInt(req.params["stopId"] as string);

  const [route] = await db
    .select()
    .from(routesTable)
    .where(and(eq(routesTable.id, routeId), eq(routesTable.userId, authReq.userId), isNull(routesTable.deletedAt)))
    .limit(1);

  if (!route) {
    res.status(404).json({ error: "not_found", message: "Route not found" });
    return;
  }

  if (route.status === "completed") {
    res.status(400).json({ error: "bad_request", message: "Route is completed and stops cannot be modified. Reset it first." });
    return;
  }


  await db.delete(routeStopsTable).where(and(eq(routeStopsTable.id, stopId), eq(routeStopsTable.routeId, routeId)));

  // Notify live viewers so the truck starts moving immediately
  if (["in_progress", "paused"].includes(route.status)) {
    const routeUpdatedMsg = { type: "route_updated", routeId: route.id };
    broadcastToRoute(route.id, routeUpdatedMsg);
    const activeLinks = await db
      .select()
      .from(shareLinksTable)
      .where(and(eq(shareLinksTable.routeId, route.id), eq(shareLinksTable.active, true)));
    for (const sl of activeLinks) {
      broadcastToToken(sl.token, routeUpdatedMsg);
    }
  }

  res.status(204).send();
});

export default router;
