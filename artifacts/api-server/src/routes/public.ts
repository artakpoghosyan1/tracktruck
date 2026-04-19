import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, routesTable, simulationStatesTable, shareLinksTable, routeStopsTable } from "@workspace/db";
import { GetPublicTrackParams, GetPublicTrackStateParams } from "@workspace/api-zod";
import { validate } from "../middlewares/validate";
import { positionAlongPolyline } from "../lib/geo";

const router: IRouter = Router();

async function getRouteByToken(token: string) {
  const [shareLink] = await db
    .select()
    .from(shareLinksTable)
    .where(and(eq(shareLinksTable.token, token), eq(shareLinksTable.active, true)))
    .limit(1);

  if (!shareLink) return null;

  const [route] = await db.select().from(routesTable).where(eq(routesTable.id, shareLink.routeId)).limit(1);
  if (!route) return null;

  return { route, shareLink };
}

function computeSnapshot(route: typeof routesTable.$inferSelect, simState: typeof simulationStatesTable.$inferSelect | undefined) {
  if (!simState) return null;

  const polyline = (route.polyline as number[][]) || [];
  const speedMs = (route.truckSpeedMph * 1609.34) / 3600;

  let totalElapsedMs = simState.effectiveElapsedMs;
  if (route.status === "in_progress" && simState.startedAt) {
    totalElapsedMs += Date.now() - simState.startedAt.getTime();
  }

  const distanceTraveledM = simState.distanceTraveledM != null
    ? simState.distanceTraveledM
    : (totalElapsedMs / 1000) * speedMs;
  const pos = positionAlongPolyline(polyline, distanceTraveledM);

  return {
    routeId: route.id,
    timestamp: new Date().toISOString(),
    status: pos.completed ? "completed" : route.status,
    distanceTraveledM: distanceTraveledM,
    progressPercent: simState.progressPercent || pos.progressPercent,
    lat: pos.lat || null,
    lng: pos.lng || null,
    bearing: pos.bearing ?? null,
  };
}

router.get("/public/track/:token", validate({ params: GetPublicTrackParams }), async (req, res) => {
  const { token } = req.params as { token: string };

  const result = await getRouteByToken(token);
  if (!result) {
    res.status(404).json({ error: "not_found", message: "No active route found. This tracking link is invalid, expired, or no longer available." });
    return;
  }

  const { route } = result;

  const [stops, simStates] = await Promise.all([
    db.select().from(routeStopsTable).where(eq(routeStopsTable.routeId, route.id)).orderBy(routeStopsTable.sortOrder),
    db.select().from(simulationStatesTable).where(eq(simulationStatesTable.routeId, route.id)).limit(1),
  ]);

  const simState = simStates[0];
  const snapshot = computeSnapshot(route, simState);

  res.json({
    routeId: route.id,
    routeName: route.name,
    status: route.status,
    startLat: route.startLat,
    startLng: route.startLng,
    endLat: route.endLat,
    endLng: route.endLng,
    polyline: (route.polyline as number[][]) || [],
    stops: stops.map((s) => ({
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      durationMinutes: s.durationMinutes,
      sortOrder: s.sortOrder,
    })),
    distanceM: route.distanceM,
    estimatedDurationS: route.estimatedDurationS,
    showSpeedPublic: route.showSpeedPublic,
    snapshot,
  });
});

router.get("/public/track/:token/state", validate({ params: GetPublicTrackStateParams }), async (req, res) => {
  const { token } = req.params as { token: string };

  const result = await getRouteByToken(token);
  if (!result) {
    res.status(404).json({ error: "not_found", message: "No active route found." });
    return;
  }

  const { route } = result;

  const [simStates] = await Promise.all([
    db.select().from(simulationStatesTable).where(eq(simulationStatesTable.routeId, route.id)).limit(1),
  ]);

  const simState = simStates[0];
  const snapshot = computeSnapshot(route, simState);

  if (!snapshot) {
    res.json({
      routeId: route.id,
      status: route.status,
      startedAt: null,
      pausedAt: null,
      effectiveElapsedMs: 0,
      distanceTraveledM: 0,
      progressPercent: 0,
      lat: null,
      lng: null,
      bearing: null,
    });
    return;
  }

  res.json({
    routeId: route.id,
    status: route.status,
    startedAt: simState?.startedAt?.toISOString() ?? null,
    pausedAt: simState?.pausedAt?.toISOString() ?? null,
    effectiveElapsedMs: simState?.effectiveElapsedMs ?? 0,
    distanceTraveledM: snapshot.distanceTraveledM,
    progressPercent: snapshot.progressPercent,
    lat: snapshot.lat,
    lng: snapshot.lng,
    bearing: snapshot.bearing,
  });
});

export default router;
