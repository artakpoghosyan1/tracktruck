import { Router, type IRouter } from "express";
import { eq, and, ilike, desc, asc, isNull, sql, count } from "drizzle-orm";
import { db, routesTable, routeStopsTable, shareLinksTable, paymentOrdersTable } from "@workspace/db";
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

  const [shareLinks, payments] =
    routeIds.length > 0
      ? await Promise.all([
          db.select().from(shareLinksTable).where(
            and(
              sql`${shareLinksTable.routeId} = ANY(${sql`ARRAY[${sql.join(routeIds.map((id) => sql`${id}`), sql`, `)}]::int[]`})`,
              eq(shareLinksTable.active, true),
            ),
          ),
          db
            .select()
            .from(paymentOrdersTable)
            .where(
              sql`${paymentOrdersTable.routeId} = ANY(${sql`ARRAY[${sql.join(routeIds.map((id) => sql`${id}`), sql`, `)}]::int[]`})`,
            )
            .orderBy(desc(paymentOrdersTable.createdAt)),
        ])
      : [[], []];

  const shareMap = new Map(shareLinks.map((sl) => [sl.routeId, sl]));
  const paymentMap = new Map<number, (typeof payments)[0]>();
  for (const p of payments) {
    if (!paymentMap.has(p.routeId)) paymentMap.set(p.routeId, p);
  }

  const data = routes.map((r) => {
    const shareLink = shareMap.get(r.id);
    const payment = paymentMap.get(r.id);
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      startLat: r.startLat,
      startLng: r.startLng,
      endLat: r.endLat,
      endLng: r.endLng,
      truckSpeedKmh: r.truckSpeedKmh,
      paymentStatus: payment?.status ?? null,
      shareToken: shareLink?.token ?? null,
      shareLinkActive: shareLink?.active ?? false,
      lastActivationDate: payment?.paidAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });

  res.json({ data, total, page: pageNum, pageSize });
});

router.post("/routes", validate({ body: CreateRouteBody }), async (req, res) => {
  const authReq = req as AuthRequest;
  const { name, startLat, startLng, endLat, endLng, truckSpeedKmh = 60, polyline = [] } = req.body as {
    name: string;
    startLat: number;
    startLng: number;
    endLat: number;
    endLng: number;
    truckSpeedKmh?: number;
    polyline?: number[][];
  };

  const { totalPolylineDistance } = await import("../lib/geo");
  const distanceM = polyline.length > 1 ? totalPolylineDistance(polyline) : 0;
  const estimatedDurationS = truckSpeedKmh > 0 ? (distanceM / 1000 / truckSpeedKmh) * 3600 : 0;

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
    distanceM: route.distanceM,
    estimatedDurationS: route.estimatedDurationS,
    paymentStatus: null,
    shareToken: null,
    shareLinkActive: false,
    lastActivationDate: null,
    stops: [],
    createdAt: route.createdAt.toISOString(),
    updatedAt: route.updatedAt.toISOString(),
  });
});

router.get("/routes/:id", validate({ params: GetRouteParams }), async (req, res) => {
  const authReq = req as AuthRequest;
  const id = parseInt(req.params["id"]!);

  const [route] = await db
    .select()
    .from(routesTable)
    .where(and(eq(routesTable.id, id), eq(routesTable.userId, authReq.userId), isNull(routesTable.deletedAt)))
    .limit(1);

  if (!route) {
    res.status(404).json({ error: "not_found", message: "Route not found" });
    return;
  }

  const [stops, shareLinks, payments] = await Promise.all([
    db.select().from(routeStopsTable).where(eq(routeStopsTable.routeId, id)).orderBy(asc(routeStopsTable.sortOrder)),
    db.select().from(shareLinksTable).where(and(eq(shareLinksTable.routeId, id), eq(shareLinksTable.active, true))).limit(1),
    db.select().from(paymentOrdersTable).where(eq(paymentOrdersTable.routeId, id)).orderBy(desc(paymentOrdersTable.createdAt)).limit(1),
  ]);

  const shareLink = shareLinks[0];
  const payment = payments[0];

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
    distanceM: route.distanceM,
    estimatedDurationS: route.estimatedDurationS,
    paymentStatus: payment?.status ?? null,
    shareToken: shareLink?.token ?? null,
    shareLinkActive: shareLink?.active ?? false,
    lastActivationDate: payment?.paidAt?.toISOString() ?? null,
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
  const id = parseInt(req.params["id"]!);

  const [existing] = await db
    .select()
    .from(routesTable)
    .where(and(eq(routesTable.id, id), eq(routesTable.userId, authReq.userId), isNull(routesTable.deletedAt)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "not_found", message: "Route not found" });
    return;
  }

  const { name, startLat, startLng, endLat, endLng, truckSpeedKmh, polyline } = req.body as {
    name?: string;
    startLat?: number;
    startLng?: number;
    endLat?: number;
    endLng?: number;
    truckSpeedKmh?: number;
    polyline?: number[][];
  };

  const newPolyline = polyline ?? existing.polyline ?? [];
  const newSpeed = truckSpeedKmh ?? existing.truckSpeedKmh;
  const { totalPolylineDistance } = await import("../lib/geo");
  const distanceM = newPolyline.length > 1 ? totalPolylineDistance(newPolyline) : existing.distanceM;
  const estimatedDurationS = newSpeed > 0 ? (distanceM / 1000 / newSpeed) * 3600 : existing.estimatedDurationS;

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
      distanceM,
      estimatedDurationS,
      updatedAt: new Date(),
    })
    .where(eq(routesTable.id, id))
    .returning();

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
    distanceM: updated.distanceM,
    estimatedDurationS: updated.estimatedDurationS,
    paymentStatus: null,
    shareToken: null,
    shareLinkActive: false,
    lastActivationDate: null,
    stops: [],
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

router.delete("/routes/:id", validate({ params: DeleteRouteParams }), async (req, res) => {
  const authReq = req as AuthRequest;
  const id = parseInt(req.params["id"]!);

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
  const routeId = parseInt(req.params["id"]!);

  const [route] = await db
    .select()
    .from(routesTable)
    .where(and(eq(routesTable.id, routeId), eq(routesTable.userId, authReq.userId), isNull(routesTable.deletedAt)))
    .limit(1);

  if (!route) {
    res.status(404).json({ error: "not_found", message: "Route not found" });
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
    const routeId = parseInt(req.params["id"]!);
    const stopId = parseInt(req.params["stopId"]!);

    const [route] = await db
      .select()
      .from(routesTable)
      .where(and(eq(routesTable.id, routeId), eq(routesTable.userId, authReq.userId), isNull(routesTable.deletedAt)))
      .limit(1);

    if (!route) {
      res.status(404).json({ error: "not_found", message: "Route not found" });
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
  const routeId = parseInt(req.params["id"]!);
  const stopId = parseInt(req.params["stopId"]!);

  const [route] = await db
    .select()
    .from(routesTable)
    .where(and(eq(routesTable.id, routeId), eq(routesTable.userId, authReq.userId), isNull(routesTable.deletedAt)))
    .limit(1);

  if (!route) {
    res.status(404).json({ error: "not_found", message: "Route not found" });
    return;
  }

  await db.delete(routeStopsTable).where(and(eq(routeStopsTable.id, stopId), eq(routeStopsTable.routeId, routeId)));

  res.status(204).send();
});

export default router;
