import { eq, and, asc } from "drizzle-orm";
import { db, routesTable, simulationStatesTable, shareLinksTable, routeStopsTable } from "@workspace/db";
import { positionAlongPolyline, haversineM } from "./geo";
import { broadcastToToken, broadcastToRoute } from "../routes/ws";

const TICK_INTERVAL_MS = 2000;
const DB_SAVE_INTERVAL_TICKS = 5;

interface SpeedSegment {
  distanceM: number;
  speedKmh: number;
}

interface StopEntry {
  /** Distance along the polyline (metres from start) where this stop sits */
  distanceAlongPolylineM: number;
  durationS: number;
  name: string;
}

// ---------------------------------------------------------------------------
// Speed-profile helpers
// ---------------------------------------------------------------------------

/** Return a copy of the profile with the first `fromDistM` metres removed */
function trimSpeedProfile(profile: SpeedSegment[], fromDistM: number): SpeedSegment[] {
  const result: SpeedSegment[] = [];
  let remaining = fromDistM;
  for (const seg of profile) {
    if (!isFinite(seg.speedKmh) || seg.speedKmh <= 0 || !isFinite(seg.distanceM) || seg.distanceM <= 0) continue;
    if (remaining >= seg.distanceM) {
      remaining -= seg.distanceM;
    } else if (remaining > 0) {
      result.push({ distanceM: seg.distanceM - remaining, speedKmh: seg.speedKmh });
      remaining = 0;
    } else {
      result.push(seg);
    }
  }
  return result;
}

/** How many seconds does it take to travel `distanceM` metres using the profile? */
function timeForDistance(distanceM: number, profile: SpeedSegment[], fallbackKmh: number): number {
  let remaining = distanceM;
  let totalS = 0;
  for (const seg of profile) {
    if (!isFinite(seg.speedKmh) || seg.speedKmh <= 0 || !isFinite(seg.distanceM) || seg.distanceM <= 0) continue;
    const speedMs = (seg.speedKmh * 1000) / 3600;
    const used = Math.min(seg.distanceM, remaining);
    totalS += used / speedMs;
    remaining -= used;
    if (remaining <= 0) return totalS;
  }
  if (remaining > 0) {
    totalS += remaining / ((fallbackKmh * 1000) / 3600);
  }
  return totalS;
}

/** Current speed (km/h) at a given distance along the route */
function speedAtDistanceM(profile: SpeedSegment[], distanceM: number, fallbackKmh: number): number {
  if (!profile || profile.length === 0) return fallbackKmh;
  const remaining = trimSpeedProfile(profile, distanceM);
  return remaining.length > 0 ? remaining[0].speedKmh : fallbackKmh;
}

/** How many metres does the truck travel in `elapsedS` seconds using the profile? */
function computeDistanceWithSpeedProfile(
  elapsedS: number,
  speedProfile: SpeedSegment[],
  fallbackSpeedKmh: number,
): number {
  if (!speedProfile || speedProfile.length === 0) {
    return elapsedS * ((fallbackSpeedKmh * 1000) / 3600);
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
    totalDistanceM += remainingS * ((fallbackSpeedKmh * 1000) / 3600);
  }
  return totalDistanceM;
}

// ---------------------------------------------------------------------------
// Stop projection
// ---------------------------------------------------------------------------

/**
 * Find the cumulative distance along the polyline to the vertex that is
 * closest to (targetLat, targetLng).  We use this to map a stop's geographic
 * coordinate to a "distance from start" value.
 */
function distanceAlongPolylineToNearestVertex(
  polyline: number[][], // [lng, lat][]
  targetLat: number,
  targetLng: number,
): number {
  let minDist = Infinity;
  let distAtMin = 0;
  let cumDist = 0;

  for (let i = 0; i < polyline.length; i++) {
    const d = haversineM(polyline[i][1], polyline[i][0], targetLat, targetLng);
    if (d < minDist) {
      minDist = d;
      distAtMin = cumDist;
    }
    if (i < polyline.length - 1) {
      cumDist += haversineM(polyline[i][1], polyline[i][0], polyline[i + 1][1], polyline[i + 1][0]);
    }
  }
  return distAtMin;
}

// ---------------------------------------------------------------------------
// Stop-aware position calculation
// ---------------------------------------------------------------------------

interface PositionWithStop {
  lat: number;
  lng: number;
  bearing: number;
  distanceTraveledM: number;
  progressPercent: number;
  completed: boolean;
  atStopName: string | null;
}

/**
 * Given total elapsed seconds (including stop wait time), compute the truck's
 * current position accounting for stops where it pauses.
 */
function computePositionWithStops(
  totalElapsedS: number,
  polyline: number[][],
  sortedStops: StopEntry[],
  speedProfile: SpeedSegment[],
  fallbackSpeedKmh: number,
): PositionWithStop {
  let remainingS = totalElapsedS;
  let travelDistConsumedM = 0;

  for (const stop of sortedStops) {
    const legDistM = stop.distanceAlongPolylineM - travelDistConsumedM;
    if (legDistM <= 0) continue; // stop is behind current position (shouldn't happen if sorted)

    // Time to drive from current position to this stop
    const trimmedProfile = trimSpeedProfile(speedProfile, travelDistConsumedM);
    const legTimeS = timeForDistance(legDistM, trimmedProfile, fallbackSpeedKmh);

    if (remainingS < legTimeS) {
      // Still driving toward this stop
      const additionalDistM = computeDistanceWithSpeedProfile(remainingS, trimmedProfile, fallbackSpeedKmh);
      const pos = positionAlongPolyline(polyline, travelDistConsumedM + additionalDistM);
      return { ...pos, atStopName: null };
    }

    remainingS -= legTimeS;
    travelDistConsumedM = stop.distanceAlongPolylineM;

    if (remainingS < stop.durationS) {
      // Truck is currently at this stop, waiting
      const pos = positionAlongPolyline(polyline, stop.distanceAlongPolylineM);
      return { ...pos, atStopName: stop.name };
    }

    remainingS -= stop.durationS;
  }

  // Past all stops — drive to destination
  const trimmedProfile = trimSpeedProfile(speedProfile, travelDistConsumedM);
  const additionalDistM = computeDistanceWithSpeedProfile(remainingS, trimmedProfile, fallbackSpeedKmh);
  const pos = positionAlongPolyline(polyline, travelDistConsumedM + additionalDistM);
  return { ...pos, atStopName: null };
}

// ---------------------------------------------------------------------------
// Simulation tick
// ---------------------------------------------------------------------------

let tickCount = 0;

async function tick() {
  tickCount++;

  const activeRoutes = await db
    .select({ route: routesTable, simState: simulationStatesTable })
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
    const polyline = (route.polyline as number[][]) || [];

    // Load stops for this route
    const dbStops = await db
      .select()
      .from(routeStopsTable)
      .where(eq(routeStopsTable.routeId, route.id))
      .orderBy(asc(routeStopsTable.sortOrder));

    // Project each stop onto the polyline
    const sortedStops: StopEntry[] = dbStops.map((s) => ({
      distanceAlongPolylineM: distanceAlongPolylineToNearestVertex(polyline, s.lat, s.lng),
      durationS: s.durationMinutes * 60,
      name: s.name,
    })).sort((a, b) => a.distanceAlongPolylineM - b.distanceAlongPolylineM);

    const pos = computePositionWithStops(
      totalElapsedS,
      polyline,
      sortedStops,
      speedProfile,
      route.truckSpeedKmh,
    );

    const baseSpeedKmh = speedAtDistanceM(speedProfile, pos.distanceTraveledM, route.truckSpeedKmh);
    // Add smooth sinusoidal fluctuation so speed feels natural rather than constant
    const fluctuation = Math.sin(totalElapsedS / 22) * 7 + Math.sin(totalElapsedS / 7) * 3;
    const currentSpeedKmh = pos.atStopName
      ? 0
      : Math.max(10, Math.round(baseSpeedKmh + fluctuation));

    const snapshot = {
      type: "snapshot",
      routeId: route.id,
      timestamp: new Date().toISOString(),
      status: pos.completed ? "completed" : pos.atStopName ? "at_stop" : "in_progress",
      atStopName: pos.atStopName ?? null,
      distanceTraveledM: pos.distanceTraveledM,
      progressPercent: pos.progressPercent,
      lat: pos.lat,
      lng: pos.lng,
      bearing: pos.bearing,
      speedKmh: currentSpeedKmh,
    };

    // Broadcast to all active share links for this route
    const shareLinks = await db
      .select()
      .from(shareLinksTable)
      .where(and(eq(shareLinksTable.routeId, route.id), eq(shareLinksTable.active, true)));

    for (const sl of shareLinks) {
      broadcastToToken(sl.token, snapshot);
    }

    // Also broadcast to any admin clients watching this route live
    broadcastToRoute(route.id, snapshot);

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

      await db.update(shareLinksTable).set({ active: false }).where(eq(shareLinksTable.routeId, route.id));
      continue;
    }

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
