import { eq, and, asc } from "drizzle-orm";
import { db, routesTable, simulationStatesTable, shareLinksTable, routeStopsTable } from "@workspace/db";
import { positionAlongPolyline, haversineM } from "./geo";
import { broadcastToToken, broadcastToRoute } from "../routes/ws";

const TICK_INTERVAL_MS = 2000;
const DB_SAVE_INTERVAL_TICKS = 5;

interface SpeedSegment {
  distanceM: number;
  speedMph: number;
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
    if (!isFinite(seg.speedMph) || seg.speedMph <= 0 || !isFinite(seg.distanceM) || seg.distanceM <= 0) continue;
    if (remaining >= seg.distanceM) {
      remaining -= seg.distanceM;
    } else if (remaining > 0) {
      result.push({ distanceM: seg.distanceM - remaining, speedMph: seg.speedMph });
      remaining = 0;
    } else {
      result.push(seg);
    }
  }
  return result;
}

/** How many seconds does it take to travel `distanceM` metres using the profile? */
function timeForDistance(distanceM: number, profile: SpeedSegment[], fallbackMph: number): number {
  let remaining = distanceM;
  let totalS = 0;
  for (const seg of profile) {
    if (!isFinite(seg.speedMph) || seg.speedMph <= 0 || !isFinite(seg.distanceM) || seg.distanceM <= 0) continue;
    const speedMs = (seg.speedMph * 1609.34) / 3600;
    const used = Math.min(seg.distanceM, remaining);
    totalS += used / speedMs;
    remaining -= used;
    if (remaining <= 0) return totalS;
  }
  if (remaining > 0) {
    totalS += remaining / ((fallbackMph * 1609.34) / 3600);
  }
  return totalS;
}

/** Current speed (mph) at a given distance along the route */
function speedAtDistanceM(profile: SpeedSegment[], distanceM: number, fallbackMph: number): number {
  if (!profile || profile.length === 0) return fallbackMph;
  const remaining = trimSpeedProfile(profile, distanceM);
  return remaining.length > 0 ? remaining[0].speedMph : fallbackMph;
}

/** How many metres does the truck travel in `elapsedS` seconds using the profile? */
function computeDistanceWithSpeedProfile(
  elapsedS: number,
  speedProfile: SpeedSegment[],
  fallbackSpeedMph: number,
): number {
  if (!speedProfile || speedProfile.length === 0) {
    return elapsedS * ((fallbackSpeedMph * 1609.34) / 3600);
  }
  let remainingS = elapsedS;
  let totalDistanceM = 0;
  for (const seg of speedProfile) {
    if (!isFinite(seg.speedMph) || seg.speedMph <= 0 || !isFinite(seg.distanceM) || seg.distanceM <= 0) continue;
    const segSpeedMs = (seg.speedMph * 1609.34) / 3600;
    const segTimeS = seg.distanceM / segSpeedMs;
    if (remainingS <= segTimeS) {
      totalDistanceM += remainingS * segSpeedMs;
      return totalDistanceM;
    }
    totalDistanceM += seg.distanceM;
    remainingS -= segTimeS;
  }
  if (remainingS > 0) {
    totalDistanceM += remainingS * ((fallbackSpeedMph * 1609.34) / 3600);
  }
  return totalDistanceM;
}

// ---------------------------------------------------------------------------
// Speed-profile scaling
// ---------------------------------------------------------------------------

/**
 * Scale the speed profile so the truck actually moves at the pace the admin
 * configured via `truckSpeedMph`.
 *
 * The raw Mapbox / OSRM profile contains realistic traffic-modelled speeds
 * (often 10-20 mph in urban areas).  Even when the distance-weighted average
 * is fine, individual slow segments dominate the *time* budget and make the
 * truck crawl for the first portion of the route.
 *
 * Strategy:
 *  1. Enforce a per-segment minimum speed floor (50% of targetAvgMph) so no
 *     segment is absurdly slow.
 *  2. After flooring, proportionally scale all segments so the distance-
 *     weighted average equals `targetAvgMph`.
 *
 * This preserves relative variation (highways stay faster than urban) while
 * eliminating the crawl problem.
 */
function scaleSpeedProfile(profile: SpeedSegment[], targetAvgMph: number): SpeedSegment[] {
  if (!profile || profile.length === 0 || targetAvgMph <= 0) return profile;

  const minFloorMph = targetAvgMph * 0.75; // no segment slower than 75% of target

  // Step 1: apply the floor
  const floored = profile.map(seg => ({
    distanceM: seg.distanceM,
    speedMph: (!isFinite(seg.speedMph) || seg.speedMph <= 0)
      ? targetAvgMph
      : Math.max(seg.speedMph, minFloorMph),
  }));

  // Step 2: compute the distance-weighted average after flooring
  let totalDist = 0;
  let totalTimeS = 0;
  for (const seg of floored) {
    if (seg.distanceM <= 0) continue;
    totalDist += seg.distanceM;
    totalTimeS += seg.distanceM / (seg.speedMph * 1609.34 / 3600);
  }

  if (totalDist <= 0 || totalTimeS <= 0) return floored;

  const flooredAvgMph = (totalDist / totalTimeS) * 3600 / 1609.34;
  if (flooredAvgMph <= 0 || !isFinite(flooredAvgMph)) return floored;

  // If already at or above target after flooring, return as-is
  if (flooredAvgMph >= targetAvgMph) return floored;

  // Step 3: proportionally scale to hit the target average
  const scaleFactor = targetAvgMph / flooredAvgMph;
  return floored.map(seg => ({
    distanceM: seg.distanceM,
    speedMph: seg.speedMph * scaleFactor,
  }));
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
 * at sharp turns on urban road segments (speed < 50 mph).
 * Only stops AHEAD of `aheadOfDistM` are returned, so existing routes don't
 * jump backwards when the engine first applies these events.
 */
function buildIntersectionStops(
  polyline: number[][],
  speedProfile: SpeedSegment[],
  fallbackMph: number,
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
    const localSpeed = speedAtDistanceM(speedProfile, cumDist, fallbackMph);
    if (localSpeed >= 50) continue;

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
  fallbackSpeedMph: number,
  speedMultiplier: number = 1.0,
): PositionWithStop {
  let remainingS = totalElapsedS;
  let travelDistConsumedM = 0;

  for (const stop of sortedStops) {
    const legDistM = stop.distanceAlongPolylineM - travelDistConsumedM;
    if (legDistM <= 0) continue;

    // Time to drive this leg at natural speed
    const trimmedProfile = trimSpeedProfile(speedProfile, travelDistConsumedM);
    const legTimeS = timeForDistance(legDistM, trimmedProfile, fallbackSpeedMph);
    // Real time for this leg = natural time / multiplier (faster multiplier = less real time)
    const realLegTimeS = legTimeS / speedMultiplier;

    if (remainingS < realLegTimeS) {
      // Still driving toward this stop — scale remaining time by multiplier
      const virtualDrivingS = remainingS * speedMultiplier;
      const additionalDistM = computeDistanceWithSpeedProfile(virtualDrivingS, trimmedProfile, fallbackSpeedMph);
      const pos = positionAlongPolyline(polyline, travelDistConsumedM + additionalDistM);
      return { ...pos, atStopName: null };
    }

    remainingS -= realLegTimeS;
    travelDistConsumedM = stop.distanceAlongPolylineM;

    // Stops ALWAYS take their full duration (not affected by multiplier)
    if (remainingS < stop.durationS) {
      const pos = positionAlongPolyline(polyline, stop.distanceAlongPolylineM);
      return { ...pos, atStopName: stop.name };
    }

    remainingS -= stop.durationS;
  }

  // Past all stops — drive to destination
  const trimmedProfile = trimSpeedProfile(speedProfile, travelDistConsumedM);
  const virtualDrivingS = remainingS * speedMultiplier;
  const additionalDistM = computeDistanceWithSpeedProfile(virtualDrivingS, trimmedProfile, fallbackSpeedMph);
  const pos = positionAlongPolyline(polyline, travelDistConsumedM + additionalDistM);
  return { ...pos, atStopName: null };
}

// ---------------------------------------------------------------------------
// Simulation tick
// ---------------------------------------------------------------------------

const COMPLETION_GRACE_S = 5; // seconds to linger at destination before marking as completed

/** routeId → Date.now() when pos.completed first became true (grace period start) */
const completionGraceMap = new Map<number, number>();
/** routeId → whether the truck was at ANY stop on the previous tick */
const wasAtStopMap = new Map<number, boolean>();
/** routeId → totalElapsedS when the truck last exited a stop (for per-stop ramp-up) */
const lastStopExitSMap = new Map<number, number>();

let tickCount = 0;

interface CachedRoute {
  speedProfile: SpeedSegment[];
  sortedStops: StopEntry[];
  shareTokens: string[];
  polyline: number[][];
}

const routeCache = new Map<number, CachedRoute>();

export function invalidateRouteCache(routeId: number) {
  routeCache.delete(routeId);
}

async function tick() {
  tickCount++;

  const activeRoutes = await db
    .select({
      route: {
        id: routesTable.id,
        status: routesTable.status,
        truckSpeedMph: routesTable.truckSpeedMph,
        customDurationS: routesTable.customDurationS,
        customDurationEnabled: routesTable.customDurationEnabled,
        estimatedDurationS: routesTable.estimatedDurationS,
        distanceM: routesTable.distanceM,
      },
      simState: simulationStatesTable
    })
    .from(routesTable)
    .innerJoin(simulationStatesTable, eq(simulationStatesTable.routeId, routesTable.id))
    .where(eq(routesTable.status, "in_progress"));

  for (const { route, simState } of activeRoutes) {
    if (!simState.startedAt) continue;

    const nowMs = Date.now();
    const wallElapsedMs = simState.startedAt ? nowMs - simState.startedAt.getTime() : 0;
    const totalElapsedMs = simState.effectiveElapsedMs + wallElapsedMs;
    const totalElapsedS = totalElapsedMs / 1000;

    let cache = routeCache.get(route.id);

    if (!cache) {
      const [fullRoute] = await db
        .select({ polyline: routesTable.polyline, speedProfile: routesTable.speedProfile })
        .from(routesTable)
        .where(eq(routesTable.id, route.id))
        .limit(1);

      const polyline = (fullRoute?.polyline as number[][]) || [];
      const rawSpeedProfile = (fullRoute?.speedProfile as SpeedSegment[] | null) || [];
      const speedProfile = scaleSpeedProfile(rawSpeedProfile, route.truckSpeedMph);

      const dbStops = await db
        .select()
        .from(routeStopsTable)
        .where(eq(routeStopsTable.routeId, route.id))
        .orderBy(asc(routeStopsTable.sortOrder));

      const realStops: StopEntry[] = dbStops.map((s) => ({
        distanceAlongPolylineM: distanceAlongPolylineToNearestVertex(polyline, s.lat, s.lng),
        durationS: s.durationMinutes * 60,
        name: s.name,
      }));

      const trafficStops = buildIntersectionStops(polyline, speedProfile, route.truckSpeedMph, 0);

      const sortedStops: StopEntry[] = [...realStops, ...trafficStops]
        .sort((a, b) => a.distanceAlongPolylineM - b.distanceAlongPolylineM);

      const shareLinks = await db
        .select()
        .from(shareLinksTable)
        .where(and(eq(shareLinksTable.routeId, route.id), eq(shareLinksTable.active, true)));

      cache = {
        speedProfile,
        sortedStops,
        shareTokens: shareLinks.map(sl => sl.token),
        polyline,
      };

      routeCache.set(route.id, cache);
    }

    const polyline = cache.polyline;

    const speedMultiplier = (route.customDurationEnabled && route.customDurationS && route.customDurationS > 0)
      ? (route.estimatedDurationS / route.customDurationS)
      : 1.0;

    const pos = computePositionWithStops(
      totalElapsedS,
      polyline,
      cache.sortedStops,
      cache.speedProfile,
      route.truckSpeedMph,
      speedMultiplier,
    );

    const isAtAnyStop = pos.atStopName != null;
    const wasAtStop = wasAtStopMap.get(route.id) ?? false;
    if (!isAtAnyStop && wasAtStop) {
      lastStopExitSMap.set(route.id, totalElapsedS);
    }
    wasAtStopMap.set(route.id, isAtAnyStop);

    if (pos.completed) {
      if (!completionGraceMap.has(route.id)) completionGraceMap.set(route.id, Date.now());
    } else {
      completionGraceMap.delete(route.id);
    }

    const graceStartMs = completionGraceMap.get(route.id);
    const graceElapsedS = graceStartMs ? (Date.now() - graceStartMs) / 1000 : 0;
    const inGracePeriod = pos.completed && graceElapsedS < COMPLETION_GRACE_S;
    const trulyCompleted = pos.completed && graceElapsedS >= COMPLETION_GRACE_S;

    const RAMP_UP_S = 8;
    const baseSpeedMph = speedAtDistanceM(cache.speedProfile, pos.distanceTraveledM, route.truckSpeedMph);

    const routeTotalDistM = route.distanceM > 0
      ? route.distanceM
      : polyline.reduce((acc: number, _pt: number[], i: number) =>
        i === 0 ? 0 : acc + haversineM(polyline[i - 1][1], polyline[i - 1][0], polyline[i][1], polyline[i][0]), 0);

    const nextStopAhead = cache.sortedStops.find(s => s.distanceAlongPolylineM > pos.distanceTraveledM + 1);
    const distToNextStopM = nextStopAhead
      ? nextStopAhead.distanceAlongPolylineM - pos.distanceTraveledM
      : Infinity;
    const distToEndM = inGracePeriod ? 0 : Math.max(0, routeTotalDistM - pos.distanceTraveledM);
    const closestEventM = Math.min(distToNextStopM, distToEndM);

    const BRAKING_ZONE_M = 220;
    const drivingBrakeFactor = inGracePeriod
      ? 0
      : closestEventM < BRAKING_ZONE_M
        ? Math.max(0.05, closestEventM / BRAKING_ZONE_M)
        : 1.0;

    const graceBrakeFactor = inGracePeriod
      ? Math.max(0, 1 - graceElapsedS / COMPLETION_GRACE_S)
      : 1.0;

    const combinedBrakeFactor = drivingBrakeFactor * graceBrakeFactor;

    const fluctMult = 1.0
      + Math.sin(totalElapsedS / 22) * 0.08
      + Math.sin(totalElapsedS / 7) * 0.04
      + Math.sin(totalElapsedS / 3) * 0.02;

    const lastStopExitS = lastStopExitSMap.get(route.id) ?? -Infinity;
    const timeSinceStopExitS = isAtAnyStop ? 0 : totalElapsedS - lastStopExitS;
    const stopRampFactor = timeSinceStopExitS < RAMP_UP_S ? timeSinceStopExitS / RAMP_UP_S : 1.0;

    const wallElapsedS = wallElapsedMs / 1000;
    const adminRampFactor = Math.min(1.0, wallElapsedS / RAMP_UP_S);

    const rampFactor = isAtAnyStop ? 0 : Math.min(stopRampFactor, adminRampFactor);

    const MAX_ALLOWED_SPEED_MPH = 75;
    const targetSpeedMph = isAtAnyStop
      ? 0
      : Math.min(MAX_ALLOWED_SPEED_MPH, Math.max(0, baseSpeedMph * fluctMult * combinedBrakeFactor));
    const currentSpeedMph = route.customDurationS
      ? Math.round(targetSpeedMph * rampFactor * speedMultiplier)
      : Math.round(targetSpeedMph * rampFactor);

    let displayLat = pos.lat;
    let displayLng = pos.lng;
    if (pos.atStopName && pos.bearing != null) {
      const edgeOffset = destinationPoint(pos.lat, pos.lng, (pos.bearing + 90) % 360, 8);
      displayLat = edgeOffset.lat;
      displayLng = edgeOffset.lng;
    }

    const visibleStopName = pos.atStopName || null;

    const snapshot = {
      type: "snapshot",
      routeId: route.id,
      timestamp: new Date().toISOString(),
      status: trulyCompleted
        ? "completed"
        : route.status === "paused"
          ? "paused"
          : isAtAnyStop
            ? "at_stop"
            : "in_progress",
      atStopName: visibleStopName,
      distanceTraveledM: pos.distanceTraveledM,
      progressPercent: pos.progressPercent,
      lat: displayLat,
      lng: displayLng,
      bearing: pos.bearing,
      speedMph: currentSpeedMph,
    };

    for (const token of cache.shareTokens) {
      broadcastToToken(token, snapshot);
    }
    broadcastToRoute(route.id, snapshot);

    if (trulyCompleted) {
      completionGraceMap.delete(route.id);
      wasAtStopMap.delete(route.id);
      lastStopExitSMap.delete(route.id);
      invalidateRouteCache(route.id);

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

