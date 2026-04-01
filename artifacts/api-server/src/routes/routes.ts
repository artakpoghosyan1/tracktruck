import { Router, type IRouter } from "express";
import { eq, and, ilike, desc, asc, isNull, sql, count } from "drizzle-orm";
import { db, routesTable, routeStopsTable, shareLinksTable } from "@workspace/db";
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
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });

  res.json({ data, total, page: pageNum, pageSize });
});

router.post("/routes", validate({ body: CreateRouteBody }), async (req, res) => {
  const authReq = req as AuthRequest;
  const { name, startLat, startLng, endLat, endLng, truckSpeedKmh = 60, polyline = [], speedProfile = [] } = req.body as {
    name: string;
    startLat: number;
    startLng: number;
    endLat: number;
    endLng: number;
    truckSpeedKmh?: number;
    polyline?: number[][];
    speedProfile?: { distanceM: number; speedKmh: number }[];
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

  const { name, startLat, startLng, endLat, endLng, truckSpeedKmh, polyline, speedProfile } = req.body as {
    name?: string;
    startLat?: number;
    startLng?: number;
    endLat?: number;
    endLng?: number;
    truckSpeedKmh?: number;
    polyline?: number[][];
    speedProfile?: { distanceM: number; speedKmh: number }[];
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
      distanceM,
      estimatedDurationS,
      updatedAt: new Date(),
    })
    .where(eq(routesTable.id, id))
    .returning();

  // If route is live, notify all viewers that the route has changed so they refetch
  if (["in_progress", "paused"].includes(updated.status)) {
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
    shareToken: null,
    shareLinkActive: false,
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

  res.status(204).send();
});

export default router;
