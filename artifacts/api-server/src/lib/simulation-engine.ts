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
// Geo & bearing helpers
// ---------------------------------------------------------------------------

/** Forward bearing in degrees from point A to point B (both [lng, lat]) */
function computeBearingDeg(from: number[], to: number[]): number {
  const lat1 = (from[1] * Math.PI) / 180;
  const lat2 = (to[1] * Math.PI) / 180;
  const dLng = ((to[0] - from[0]) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Absolute angle between two bearings (0-180) */
function bearingDiffDeg(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Analyse the polyline to produce deterministic "virtual" traffic-light stops
 * at sharp turns on urban road segments (speed < 80 km/h).
 * Only stops AHEAD of `aheadOfDistM` are returned, so existing routes don't
 * jump backwards when the engine first applies these events.
 */
function buildIntersectionStops(
  polyline: number[][],
  speedProfile: SpeedSegment[],
  fallbackKmh: number,
  aheadOfDistM: number,
): StopEntry[] {
  const stops: StopEntry[] = [];
  let cumDist = 0;
  let lastEventDist = -300; // enforce minimum spacing between events

  for (let i = 1; i < polyline.length - 1; i++) {
    const segDist = haversineM(polyline[i - 1][1], polyline[i - 1][0], polyline[i][1], polyline[i][0]);
    cumDist += segDist;

    // Skip past positions and segments that are too close together
    if (cumDist <= aheadOfDistM) continue;
    if (cumDist - lastEventDist < 150) continue;

    // Skip highways
    const localSpeed = speedAtDistanceM(speedProfile, cumDist, fallbackKmh);
    if (localSpeed >= 80) continue;

    const bearingIn = computeBearingDeg(polyline[i - 1], polyline[i]);
    const bearingOut = computeBearingDeg(polyline[i], polyline[i + 1]);
    const angle = bearingDiffDeg(bearingIn, bearingOut);
    if (angle < 30) continue;

    // Deterministic seed from position (same route → same stops every run)
    const seed = Math.abs(Math.sin(cumDist * 0.007 + angle * 0.013));

    let probability: number;
    let minPauseS: number;
    let maxPauseS: number;

    if (angle >= 100) {
      probability = 0.70; minPauseS = 20; maxPauseS = 55;
    } else if (angle >= 70) {
      probability = 0.45; minPauseS = 12; maxPauseS = 45;
    } else if (angle >= 45) {
      probability = 0.25; minPauseS = 5; maxPauseS = 20;
    } else {
      continue;
    }

    if (seed > probability) continue;

    const pauseS = minPauseS + Math.round(seed * (maxPauseS - minPauseS));
    stops.push({
      distanceAlongPolylineM: cumDist,
      durationS: pauseS,
      name: '', // empty = virtual (traffic light — not shown in UI)
    });
    lastEventDist = cumDist;
  }

  return stops;
}

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------

/**
 * Compute a destination point given a start (lat/lng), a bearing (degrees),
 * and a distance (metres).  Uses spherical Earth model (R = 6 371 000 m).
 */
function destinationPoint(lat: number, lng: number, bearingDeg: number, distanceM: number): { lat: number; lng: number } {
  const R = 6_371_000;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  const θ = (bearingDeg * Math.PI) / 180;
  const δ = distanceM / R;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: (φ2 * 180) / Math.PI, lng: (λ2 * 180) / Math.PI };
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

    // Project real (DB) stops onto the polyline
    const realStops: StopEntry[] = dbStops.map((s) => ({
      distanceAlongPolylineM: distanceAlongPolylineToNearestVertex(polyline, s.lat, s.lng),
      durationS: s.durationMinutes * 60,
      name: s.name,
    }));

    // Inject deterministic traffic-light stops at sharp turns on urban roads.
    // Only inject stops AHEAD of the truck's last known position so that
    // enabling this for an already-running route doesn't cause a backwards jump.
    const traveledM = simState.distanceTraveledM ?? 0;
    const trafficStops = buildIntersectionStops(polyline, speedProfile, route.truckSpeedKmh, traveledM);

    // Merge and sort all stops by distance
    const sortedStops: StopEntry[] = [...realStops, ...trafficStops]
      .sort((a, b) => a.distanceAlongPolylineM - b.distanceAlongPolylineM);

    const pos = computePositionWithStops(
      totalElapsedS,
      polyline,
      sortedStops,
      speedProfile,
      route.truckSpeedKmh,
    );

    const baseSpeedKmh = speedAtDistanceM(speedProfile, pos.distanceTraveledM, route.truckSpeedKmh);

    // Whether the truck is stopped at any waypoint (real named stop OR virtual traffic light)
    // pos.atStopName is undefined when traveling, '' for virtual stops, named string for real stops
    const isAtAnyStop = pos.atStopName != null;

    // Smooth sinusoidal fluctuation for natural speed variation
    const fluctuation = Math.sin(totalElapsedS / 22) * 7 + Math.sin(totalElapsedS / 7) * 3;
    const targetSpeedKmh = isAtAnyStop ? 0 : Math.max(10, Math.round(baseSpeedKmh + fluctuation));

    // Ramp speed up gradually after each resume (wallElapsedMs resets to 0 on every resume)
    const RAMP_UP_S = 8;
    const wallElapsedS = wallElapsedMs / 1000;
    const rampFactor = isAtAnyStop ? 0 : Math.min(1.0, wallElapsedS / RAMP_UP_S);
    const currentSpeedKmh = Math.round(targetSpeedKmh * rampFactor);

    // When stopped at a waypoint, offset the marker ~8 m to the right of the road
    // so it appears to pull over to the edge rather than sitting on the centreline.
    let displayLat = pos.lat;
    let displayLng = pos.lng;
    if (pos.atStopName && pos.bearing != null) {
      const edgeOffset = destinationPoint(pos.lat, pos.lng, (pos.bearing + 90) % 360, 8);
      displayLat = edgeOffset.lat;
      displayLng = edgeOffset.lng;
    }

    // Virtual stops (traffic lights) have empty names — don't expose them to the UI
    const visibleStopName = pos.atStopName || null; // '' → null so UI shows nothing

    const snapshot = {
      type: "snapshot",
      routeId: route.id,
      timestamp: new Date().toISOString(),
      status: pos.completed ? "completed" : isAtAnyStop ? "at_stop" : "in_progress",
      atStopName: visibleStopName,
      distanceTraveledM: pos.distanceTraveledM,
      progressPercent: pos.progressPercent,
      lat: displayLat,
      lng: displayLng,
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
