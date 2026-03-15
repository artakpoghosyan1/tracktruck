import { eq, and } from "drizzle-orm";
import { db, routesTable, simulationStatesTable, shareLinksTable } from "@workspace/db";
import { positionAlongPolyline } from "./geo";
import { broadcastToToken } from "../routes/ws";

const TICK_INTERVAL_MS = 2000;
const DB_SAVE_INTERVAL_TICKS = 5;

interface SpeedSegment {
  distanceM: number;
  speedKmh: number;
}

function computeDistanceWithSpeedProfile(
  elapsedS: number,
  speedProfile: SpeedSegment[],
  fallbackSpeedKmh: number,
): number {
  if (!speedProfile || speedProfile.length === 0) {
    return elapsedS * (fallbackSpeedKmh * 1000 / 3600);
  }

  let remainingS = elapsedS;
  let totalDistanceM = 0;

  for (const seg of speedProfile) {
    if (!isFinite(seg.speedKmh) || seg.speedKmh <= 0 || !isFinite(seg.distanceM) || seg.distanceM <= 0) continue;
    const segSpeedMs = (seg.speedKmh * 1000) / 3600;
    const segTimeS = seg.distanceM / segSpeedMs;
    if (remainingS <= segTimeS) {
      totalDistanceM += remainingS * segSpeedMs;
      return totalDistanceM;
    }
    totalDistanceM += seg.distanceM;
    remainingS -= segTimeS;
  }

  if (remainingS > 0) {
    totalDistanceM += remainingS * (fallbackSpeedKmh * 1000 / 3600);
  }

  return totalDistanceM;
}

let tickCount = 0;

async function tick() {
  tickCount++;

  const activeRoutes = await db
    .select({
      route: routesTable,
      simState: simulationStatesTable,
    })
    .from(routesTable)
    .innerJoin(simulationStatesTable, eq(simulationStatesTable.routeId, routesTable.id))
    .where(eq(routesTable.status, "in_progress"));

  for (const { route, simState } of activeRoutes) {
    if (!simState.startedAt) continue;

    const nowMs = Date.now();
    const wallElapsedMs = nowMs - simState.startedAt.getTime();
    const totalElapsedMs = simState.effectiveElapsedMs + wallElapsedMs;
    const totalElapsedS = totalElapsedMs / 1000;

    const speedProfile = (route.speedProfile as SpeedSegment[] | null) || [];
    const distanceTraveledM = computeDistanceWithSpeedProfile(totalElapsedS, speedProfile, route.truckSpeedKmh);

    const polyline = (route.polyline as number[][]) || [];
    const pos = positionAlongPolyline(polyline, distanceTraveledM);

    const snapshot = {
      type: "snapshot",
      routeId: route.id,
      timestamp: new Date().toISOString(),
      status: pos.completed ? "completed" : "in_progress",
      distanceTraveledM: pos.distanceTraveledM,
      progressPercent: pos.progressPercent,
      lat: pos.lat,
      lng: pos.lng,
      bearing: pos.bearing,
    };

    // Get share tokens for this route and broadcast
    const shareLinks = await db
      .select()
      .from(shareLinksTable)
      .where(and(eq(shareLinksTable.routeId, route.id), eq(shareLinksTable.active, true)));

    for (const sl of shareLinks) {
      broadcastToToken(sl.token, snapshot);
    }

    if (pos.completed) {
      await db
        .update(routesTable)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(routesTable.id, route.id));

      await db
        .update(simulationStatesTable)
        .set({
          effectiveElapsedMs: totalElapsedMs,
          distanceTraveledM: pos.distanceTraveledM,
          progressPercent: pos.progressPercent,
          startedAt: null,
          pausedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(simulationStatesTable.routeId, route.id));

      // Deactivate share links
      await db.update(shareLinksTable).set({ active: false }).where(eq(shareLinksTable.routeId, route.id));

      continue;
    }

    // Save to DB every N ticks to reduce write load
    if (tickCount % DB_SAVE_INTERVAL_TICKS === 0) {
      await db
        .update(simulationStatesTable)
        .set({
          distanceTraveledM: pos.distanceTraveledM,
          progressPercent: pos.progressPercent,
          updatedAt: new Date(),
        })
        .where(eq(simulationStatesTable.routeId, route.id));
    }
  }
}

export function startSimulationEngine() {
  console.log("Starting simulation engine...");
  setInterval(() => {
    tick().catch((err) => console.error("Simulation tick error:", err));
  }, TICK_INTERVAL_MS);
}
