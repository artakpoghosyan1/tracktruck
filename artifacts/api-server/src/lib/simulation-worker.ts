/**
 * simulation-worker.ts
 *
 * Runs as a Node.js worker_thread.  All simulation logic lives here so the
 * CPU-heavy tick loop never competes with HTTP / WebSocket I/O on the main thread.
 *
 * Communication with the main thread:
 *   Worker → Main  { type: 'broadcast_token', token: string, data: unknown }
 *   Worker → Main  { type: 'broadcast_route', routeId: number, data: unknown }
 *   Main → Worker  { type: 'invalidate_cache', routeId: number }
 */
import { parentPort } from "worker_threads";
import { eq, and, asc, inArray, sql } from "drizzle-orm";
import { db, routesTable, simulationStatesTable, shareLinksTable, routeStopsTable } from "@workspace/db";
import { positionAlongPolyline, haversineM, distanceAlongPolylineAtPoint } from "./geo";

if (!parentPort) throw new Error("simulation-worker must be run as a worker_thread");

// ---------------------------------------------------------------------------
// Broadcast via main thread (main thread owns all WebSocket handles)
// ---------------------------------------------------------------------------
function broadcastToToken(token: string, data: unknown) {
  parentPort!.postMessage({ type: "broadcast_token", token, data });
}
function broadcastToRoute(routeId: number, data: unknown) {
  parentPort!.postMessage({ type: "broadcast_route", routeId, data });
}

const TICK_INTERVAL_MS = 2000;
const DB_SAVE_INTERVAL_TICKS = 5;

interface SpeedSegment {
  distanceM: number;
  speedMph: number;
}

interface StopEntry {
  distanceAlongPolylineM: number;
  durationS: number;
  name: string;
  routeStopId?: number;
}

// ---------------------------------------------------------------------------
// Speed-profile helpers
// ---------------------------------------------------------------------------

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
  if (remaining > 0) totalS += remaining / ((fallbackMph * 1609.34) / 3600);
  return totalS;
}

function speedAtDistanceM(profile: SpeedSegment[], distanceM: number, fallbackMph: number): number {
  if (!profile || profile.length === 0) return fallbackMph;
  const remaining = trimSpeedProfile(profile, distanceM);
  return remaining.length > 0 ? remaining[0].speedMph : fallbackMph;
}

function computeDistanceWithSpeedProfile(elapsedS: number, speedProfile: SpeedSegment[], fallbackSpeedMph: number): number {
  if (!speedProfile || speedProfile.length === 0) return elapsedS * ((fallbackSpeedMph * 1609.34) / 3600);
  let remainingS = elapsedS;
  let totalDistanceM = 0;
  for (const seg of speedProfile) {
    if (!isFinite(seg.speedMph) || seg.speedMph <= 0 || !isFinite(seg.distanceM) || seg.distanceM <= 0) continue;
    const segSpeedMs = (seg.speedMph * 1609.34) / 3600;
    const segTimeS = seg.distanceM / segSpeedMs;
    if (remainingS <= segTimeS) { totalDistanceM += remainingS * segSpeedMs; return totalDistanceM; }
    totalDistanceM += seg.distanceM;
    remainingS -= segTimeS;
  }
  if (remainingS > 0) totalDistanceM += remainingS * ((fallbackSpeedMph * 1609.34) / 3600);
  return totalDistanceM;
}

// ---------------------------------------------------------------------------
// Speed-profile scaling
// ---------------------------------------------------------------------------
function scaleSpeedProfile(profile: SpeedSegment[], targetAvgMph: number): SpeedSegment[] {
  if (!profile || profile.length === 0 || targetAvgMph <= 0) return profile;
  const minFloorMph = targetAvgMph * 0.75;
  const floored = profile.map(seg => ({
    distanceM: seg.distanceM,
    speedMph: (!isFinite(seg.speedMph) || seg.speedMph <= 0) ? targetAvgMph : Math.max(seg.speedMph, minFloorMph),
  }));
  let totalDist = 0, totalTimeS = 0;
  for (const seg of floored) {
    if (seg.distanceM <= 0) continue;
    totalDist += seg.distanceM;
    totalTimeS += seg.distanceM / (seg.speedMph * 1609.34 / 3600);
  }
  if (totalDist <= 0 || totalTimeS <= 0) return floored;
  const flooredAvgMph = (totalDist / totalTimeS) * 3600 / 1609.34;
  if (flooredAvgMph <= 0 || !isFinite(flooredAvgMph) || flooredAvgMph >= targetAvgMph) return floored;
  const scaleFactor = targetAvgMph / flooredAvgMph;
  return floored.map(seg => ({ distanceM: seg.distanceM, speedMph: seg.speedMph * scaleFactor }));
}

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------
function computeBearingDeg(from: number[], to: number[]): number {
  const lat1 = (from[1] * Math.PI) / 180, lat2 = (to[1] * Math.PI) / 180;
  const dLng = ((to[0] - from[0]) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function bearingDiffDeg(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function destinationPoint(lat: number, lng: number, bearingDeg: number, distanceM: number): { lat: number; lng: number } {
  const R = 6_371_000, φ1 = (lat * Math.PI) / 180, λ1 = (lng * Math.PI) / 180;
  const θ = (bearingDeg * Math.PI) / 180, δ = distanceM / R;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: (φ2 * 180) / Math.PI, lng: (λ2 * 180) / Math.PI };
}

function buildIntersectionStops(polyline: number[][], speedProfile: SpeedSegment[], fallbackMph: number, aheadOfDistM: number): StopEntry[] {
  const stops: StopEntry[] = [];
  let cumDist = 0, lastEventDist = -300;
  for (let i = 1; i < polyline.length - 1; i++) {
    const segDist = haversineM(polyline[i - 1][1], polyline[i - 1][0], polyline[i][1], polyline[i][0]);
    cumDist += segDist;
    if (cumDist <= aheadOfDistM || cumDist - lastEventDist < 150) continue;
    const localSpeed = speedAtDistanceM(speedProfile, cumDist, fallbackMph);
    if (localSpeed >= 50) continue;
    const bearingIn = computeBearingDeg(polyline[i - 1], polyline[i]);
    const bearingOut = computeBearingDeg(polyline[i], polyline[i + 1]);
    const angle = bearingDiffDeg(bearingIn, bearingOut);
    if (angle < 30) continue;
    const seed = Math.abs(Math.sin(cumDist * 0.007 + angle * 0.013));
    let probability: number, minPauseS: number, maxPauseS: number;
    if (angle >= 100) { probability = 0.70; minPauseS = 20; maxPauseS = 55; }
    else if (angle >= 70) { probability = 0.45; minPauseS = 12; maxPauseS = 45; }
    else if (angle >= 45) { probability = 0.25; minPauseS = 5; maxPauseS = 20; }
    else continue;
    if (seed > probability) continue;
    stops.push({ distanceAlongPolylineM: cumDist, durationS: minPauseS + Math.round(seed * (maxPauseS - minPauseS)), name: "" });
    lastEventDist = cumDist;
  }
  return stops;
}

// ---------------------------------------------------------------------------
// Stop-aware position calculation
// ---------------------------------------------------------------------------
interface PositionWithStop {
  lat: number; lng: number; bearing: number;
  distanceTraveledM: number; progressPercent: number;
  completed: boolean; atStopName: string | null;
  atStopRouteStopId: number | null;
}

function computePositionWithStops(
  totalElapsedS: number, polyline: number[][], sortedStops: StopEntry[],
  speedProfile: SpeedSegment[], fallbackSpeedMph: number, speedMultiplier: number = 1.0,
): PositionWithStop {
  let remainingS = totalElapsedS, travelDistConsumedM = 0;
  for (const stop of sortedStops) {
    const legDistM = Math.max(0, stop.distanceAlongPolylineM - travelDistConsumedM);
    const trimmedProfile = trimSpeedProfile(speedProfile, travelDistConsumedM);
    const realLegTimeS = timeForDistance(legDistM, trimmedProfile, fallbackSpeedMph) / speedMultiplier;
    if (remainingS < realLegTimeS) {
      const additionalDistM = computeDistanceWithSpeedProfile(remainingS * speedMultiplier, trimmedProfile, fallbackSpeedMph);
      return { ...positionAlongPolyline(polyline, travelDistConsumedM + additionalDistM), atStopName: null, atStopRouteStopId: null };
    }
    remainingS -= realLegTimeS;
    travelDistConsumedM = stop.distanceAlongPolylineM;
    if (remainingS < stop.durationS) {
      return {
        ...positionAlongPolyline(polyline, stop.distanceAlongPolylineM),
        atStopName: stop.name,
        atStopRouteStopId: stop.routeStopId ?? null,
      };
    }
    remainingS -= stop.durationS;
  }
  const trimmedProfile = trimSpeedProfile(speedProfile, travelDistConsumedM);
  const additionalDistM = computeDistanceWithSpeedProfile(remainingS * speedMultiplier, trimmedProfile, fallbackSpeedMph);
  return { ...positionAlongPolyline(polyline, travelDistConsumedM + additionalDistM), atStopName: null, atStopRouteStopId: null };
}

// Inverse of computePositionWithStops: given a distance along the polyline,
// return the total elapsed seconds needed to reach it (accounting for stops before it).
function timeToReachDistanceM(
  targetDistM: number,
  sortedStops: StopEntry[],
  speedProfile: SpeedSegment[],
  fallbackSpeedMph: number,
  speedMultiplier: number,
): number {
  let elapsed = 0;
  let consumed = 0;
  for (const stop of sortedStops) {
    if (stop.distanceAlongPolylineM >= targetDistM) break;
    const legDistM = Math.max(0, stop.distanceAlongPolylineM - consumed);
    elapsed += timeForDistance(legDistM, trimSpeedProfile(speedProfile, consumed), fallbackSpeedMph) / speedMultiplier;
    elapsed += stop.durationS;
    consumed = stop.distanceAlongPolylineM;
  }
  elapsed += timeForDistance(Math.max(0, targetDistM - consumed), trimSpeedProfile(speedProfile, consumed), fallbackSpeedMph) / speedMultiplier;
  return elapsed;
}

/** Stops at or slightly before the truck are kept; strictly passed stops are removed. */
const PASSED_STOP_EPS_M = 5;

function filterPassedStops(stops: StopEntry[], resumeDistM: number): StopEntry[] {
  return stops.filter(s => s.distanceAlongPolylineM >= resumeDistM - PASSED_STOP_EPS_M);
}

// ---------------------------------------------------------------------------
// Route cache
// ---------------------------------------------------------------------------
const COMPLETION_GRACE_S = 5;
const completionGraceMap = new Map<number, number>();
const wasAtStopMap = new Map<number, boolean>();
const lastStopExitSMap = new Map<number, number>();
const lastKnownDistM = new Map<number, number>();
const resumeFromPositionSet = new Set<number>();
const resumeMetadataMap = new Map<number, { oldMult: number; newMult: number }>();
let tickCount = 0;

interface CachedRoute {
  speedProfile: SpeedSegment[];
  sortedStops: StopEntry[];
  shareTokens: string[];
  polyline: number[][];
  lastAccessedTick: number;
}
const routeCache = new Map<number, CachedRoute>();

function invalidateLocalCache(routeId: number) {
  routeCache.delete(routeId);
  lastStopExitSMap.delete(routeId);
  wasAtStopMap.delete(routeId);
  resumeMetadataMap.delete(routeId);
}

// ---------------------------------------------------------------------------
// Cache warm-up
// ---------------------------------------------------------------------------
async function warmRouteCache(routeId: number, truckSpeedMph: number): Promise<void> {
  const [fullRoute] = await db
    .select({ polyline: routesTable.polyline, speedProfile: routesTable.speedProfile })
    .from(routesTable).where(eq(routesTable.id, routeId)).limit(1);

  const polyline = (fullRoute?.polyline as number[][]) || [];
  const speedProfile = scaleSpeedProfile((fullRoute?.speedProfile as SpeedSegment[] | null) || [], truckSpeedMph);

  const [dbStops, shareLinks, simStates] = await Promise.all([
    db.select().from(routeStopsTable).where(eq(routeStopsTable.routeId, routeId)).orderBy(asc(routeStopsTable.sortOrder)),
    db.select().from(shareLinksTable).where(and(eq(shareLinksTable.routeId, routeId), eq(shareLinksTable.active, true))),
    db.select({ distanceTraveledM: simulationStatesTable.distanceTraveledM })
      .from(simulationStatesTable).where(eq(simulationStatesTable.routeId, routeId)).limit(1),
  ]);

  const truckDistHint = Math.max(
    lastKnownDistM.get(routeId) ?? 0,
    simStates[0]?.distanceTraveledM ?? 0,
  );

  const realStops: StopEntry[] = dbStops.map(s => ({
    distanceAlongPolylineM: distanceAlongPolylineAtPoint(polyline, s.lat, s.lng),
    durationS: s.durationMinutes * 60,
    name: s.name,
    routeStopId: s.id,
  }));
  let sortedStops = [...realStops, ...buildIntersectionStops(polyline, speedProfile, truckSpeedMph, truckDistHint)]
    .sort((a, b) => a.distanceAlongPolylineM - b.distanceAlongPolylineM);

  if (truckDistHint > 0) {
    sortedStops = filterPassedStops(sortedStops, truckDistHint);
  }

  routeCache.set(routeId, { speedProfile, sortedStops, shareTokens: shareLinks.map(sl => sl.token), polyline, lastAccessedTick: tickCount });
}

// ---------------------------------------------------------------------------
// Batch DB writes
// ---------------------------------------------------------------------------
async function bulkSavePositions(updates: Array<{ routeId: number; distM: number; prog: number }>): Promise<void> {
  if (updates.length === 0) return;
  const values = updates.map(u => sql`(${u.routeId}::integer, ${u.distM}::double precision, ${u.prog}::double precision)`);
  await db.execute(sql`
    UPDATE simulation_states AS s
    SET distance_traveled_m = v.dist, progress_percent = v.prog, updated_at = NOW()
    FROM (VALUES ${sql.join(values, sql`, `)}) AS v(route_id, dist, prog)
    WHERE s.route_id = v.route_id
  `);
}

async function bulkCompleteRoutes(completions: Array<{ routeId: number; elapsedMs: number; distM: number; prog: number }>): Promise<void> {
  if (completions.length === 0) return;
  const ids = completions.map(c => c.routeId);
  const simValues = completions.map(c =>
    sql`(${c.routeId}::integer, ${c.elapsedMs}::double precision, ${c.distM}::double precision, ${c.prog}::double precision)`
  );
  await Promise.all([
    db.update(routesTable).set({ status: "completed", updatedAt: new Date() }).where(inArray(routesTable.id, ids)),
    db.execute(sql`
      UPDATE simulation_states AS s
      SET effective_elapsed_ms = v.elapsed, distance_traveled_m = v.dist,
          progress_percent = v.prog, started_at = NULL, paused_at = NULL,
          at_stop_route_stop_id = NULL, stop_arrived_at = NULL, updated_at = NOW()
      FROM (VALUES ${sql.join(simValues, sql`, `)}) AS v(route_id, elapsed, dist, prog)
      WHERE s.route_id = v.route_id
    `),
  ]);
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------
async function tick() {
  tickCount++;

  const activeRoutes = await db
    .select({
      route: {
        id: routesTable.id, status: routesTable.status,
        truckSpeedMph: routesTable.truckSpeedMph, customDurationS: routesTable.customDurationS,
        customDurationEnabled: routesTable.customDurationEnabled,
        estimatedDurationS: routesTable.estimatedDurationS, distanceM: routesTable.distanceM,
      },
      simState: simulationStatesTable,
    })
    .from(routesTable)
    .innerJoin(simulationStatesTable, eq(simulationStatesTable.routeId, routesTable.id))
    .where(eq(routesTable.status, "in_progress"));

  if (activeRoutes.length === 0) return;

  const cacheMisses = activeRoutes.filter(({ route }) => !routeCache.has(route.id));
  if (cacheMisses.length > 0) {
    await Promise.all(cacheMisses.map(({ route }) => warmRouteCache(route.id, route.truckSpeedMph)));
  }

  const nowMs = Date.now();
  const broadcastQueue: Array<{ tokens: string[]; routeId: number; snapshot: object }> = [];
  const positionUpdates: Array<{ routeId: number; distM: number; prog: number }> = [];
  const completions: Array<{ routeId: number; elapsedMs: number; distM: number; prog: number }> = [];

  for (const { route, simState } of activeRoutes) {
    if (!simState.startedAt) continue;
    const cache = routeCache.get(route.id);
    if (!cache) continue;

    cache.lastAccessedTick = tickCount;

    const speedMultiplier = (route.customDurationEnabled && route.customDurationS && route.customDurationS > 0)
      ? (route.estimatedDurationS / route.customDurationS) : 1.0;

    // When a stop is deleted while the truck is waiting at it, reset effectiveElapsedMs
    // so the truck continues from that position rather than jumping forward.
    let effectiveElapsedMs = simState.effectiveElapsedMs;
    let startedAtMs = simState.startedAt.getTime();
    if (resumeFromPositionSet.has(route.id)) {
      resumeFromPositionSet.delete(route.id);
      const meta = resumeMetadataMap.get(route.id);
      resumeMetadataMap.delete(route.id);

      const currentWallMs = Math.max(0, nowMs - startedAtMs);
      const currentTotalElapsedS = (effectiveElapsedMs + currentWallMs) / 1000;
      const multForCurrentPos = meta?.oldMult ?? speedMultiplier;
      const currentPos = computePositionWithStops(
        currentTotalElapsedS, cache.polyline, cache.sortedStops, cache.speedProfile, route.truckSpeedMph, multForCurrentPos,
      );
      const resumeDistM = Math.max(
        currentPos.distanceTraveledM,
        simState.distanceTraveledM ?? 0,
        lastKnownDistM.get(route.id) ?? 0,
      );

      // Drop stops the truck has already passed so recalibration does not snap back to them.
      cache.sortedStops = filterPassedStops(cache.sortedStops, resumeDistM);

      const adjustedElapsedS = timeToReachDistanceM(
        resumeDistM, cache.sortedStops, cache.speedProfile, route.truckSpeedMph, speedMultiplier,
      );
      effectiveElapsedMs = adjustedElapsedS * 1000;
      startedAtMs = nowMs;

      const resumeAlong = positionAlongPolyline(cache.polyline, resumeDistM);
      await db.update(simulationStatesTable)
        .set({
          effectiveElapsedMs,
          startedAt: new Date(nowMs),
          distanceTraveledM: resumeDistM,
          progressPercent: resumeAlong.progressPercent,
          atStopRouteStopId: currentPos.atStopRouteStopId,
          stopArrivedAt: currentPos.atStopRouteStopId
            ? (currentPos.atStopRouteStopId === simState.atStopRouteStopId && simState.stopArrivedAt
              ? simState.stopArrivedAt
              : new Date(nowMs))
            : null,
        })
        .where(eq(simulationStatesTable.routeId, route.id));
      lastKnownDistM.set(route.id, resumeDistM);
    }

    const wallElapsedMs = Math.max(0, nowMs - startedAtMs);
    const totalElapsedMs = Math.max(0, effectiveElapsedMs + wallElapsedMs);
    const totalElapsedS = totalElapsedMs / 1000;
    const polyline = cache.polyline;

    let pos = computePositionWithStops(totalElapsedS, polyline, cache.sortedStops, cache.speedProfile, route.truckSpeedMph, speedMultiplier);

    // Never snap back to a stop that is behind the furthest distance reached this session.
    const knownDistM = lastKnownDistM.get(route.id);
    if (knownDistM != null && pos.atStopRouteStopId) {
      const stopEntry = cache.sortedStops.find(s => s.routeStopId === pos.atStopRouteStopId);
      if (stopEntry && stopEntry.distanceAlongPolylineM < knownDistM - PASSED_STOP_EPS_M) {
        pos = { ...positionAlongPolyline(polyline, knownDistM), atStopName: null, atStopRouteStopId: null };
      }
    }
    if (knownDistM != null && pos.distanceTraveledM < knownDistM - PASSED_STOP_EPS_M) {
      pos = { ...positionAlongPolyline(polyline, knownDistM), atStopName: null, atStopRouteStopId: null };
    }
    lastKnownDistM.set(route.id, Math.max(knownDistM ?? 0, pos.distanceTraveledM));

    const isAtAnyStop = pos.atStopName != null;
    const isAtUserStop = pos.atStopRouteStopId != null;

    // Persist dwell start / clear so countdown survives page refresh
    let stopDwellRemainingS: number | null = null;
    let snapshotAtStopRouteStopId: number | null = null;
    if (isAtUserStop) {
      const stopEntry = cache.sortedStops.find(s => s.routeStopId === pos.atStopRouteStopId);
      let arrivedMs = simState.stopArrivedAt?.getTime() ?? null;
      if (pos.atStopRouteStopId !== simState.atStopRouteStopId) {
        arrivedMs = nowMs;
        await db.update(simulationStatesTable)
          .set({ atStopRouteStopId: pos.atStopRouteStopId, stopArrivedAt: new Date(nowMs) })
          .where(eq(simulationStatesTable.routeId, route.id));
      }
      if (stopEntry && arrivedMs != null) {
        snapshotAtStopRouteStopId = pos.atStopRouteStopId;
        stopDwellRemainingS = Math.max(0, Math.round(stopEntry.durationS - (nowMs - arrivedMs) / 1000));
      }
    } else if (simState.atStopRouteStopId != null) {
      await db.update(simulationStatesTable)
        .set({ atStopRouteStopId: null, stopArrivedAt: null })
        .where(eq(simulationStatesTable.routeId, route.id));
    }

    const wasAtStop = wasAtStopMap.get(route.id) ?? false;
    if (!isAtAnyStop && wasAtStop) lastStopExitSMap.set(route.id, totalElapsedS);
    wasAtStopMap.set(route.id, isAtAnyStop);

    if (pos.completed) { if (!completionGraceMap.has(route.id)) completionGraceMap.set(route.id, nowMs); }
    else completionGraceMap.delete(route.id);

    const graceStartMs = completionGraceMap.get(route.id);
    const graceElapsedS = graceStartMs ? (nowMs - graceStartMs) / 1000 : 0;
    const inGracePeriod = pos.completed && graceElapsedS < COMPLETION_GRACE_S;
    const trulyCompleted = pos.completed && graceElapsedS >= COMPLETION_GRACE_S;

    const RAMP_UP_S = 8;
    const baseSpeedMph = speedAtDistanceM(cache.speedProfile, pos.distanceTraveledM, route.truckSpeedMph);
    const routeTotalDistM = route.distanceM > 0
      ? route.distanceM
      : polyline.reduce((acc: number, _pt: number[], i: number) =>
          i === 0 ? 0 : acc + haversineM(polyline[i - 1][1], polyline[i - 1][0], polyline[i][1], polyline[i][0]), 0);

    const nextStopAhead = cache.sortedStops.find(s => s.distanceAlongPolylineM > pos.distanceTraveledM + 1);
    const distToNextStopM = nextStopAhead ? nextStopAhead.distanceAlongPolylineM - pos.distanceTraveledM : Infinity;
    const distToEndM = inGracePeriod ? 0 : Math.max(0, routeTotalDistM - pos.distanceTraveledM);
    const closestEventM = Math.min(distToNextStopM, distToEndM);

    const BRAKING_ZONE_M = 220;
    const effectiveSpeedMph = Math.min(route.truckSpeedMph * speedMultiplier, 60);
    const effectiveBrakingZoneM = BRAKING_ZONE_M * Math.pow(effectiveSpeedMph / 60, 2);
    const drivingBrakeFactor = inGracePeriod ? 0 : closestEventM < effectiveBrakingZoneM ? Math.max(0.05, closestEventM / effectiveBrakingZoneM) : 1.0;
    const graceBrakeFactor = inGracePeriod ? Math.max(0, 1 - graceElapsedS / COMPLETION_GRACE_S) : 1.0;
    const combinedBrakeFactor = drivingBrakeFactor * graceBrakeFactor;

    const fluctMult = 1.0 + Math.sin(totalElapsedS / 22) * 0.06 + Math.sin(totalElapsedS / 7) * 0.03 + Math.sin(totalElapsedS / 3) * 0.01;
    const effectiveRampUpS = RAMP_UP_S * Math.max(0.25, effectiveSpeedMph / 60);
    const lastStopExitS = lastStopExitSMap.get(route.id) ?? -Infinity;
    const timeSinceStopExitS = isAtAnyStop ? 0 : totalElapsedS - lastStopExitS;
    const stopRampFactor = (timeSinceStopExitS >= 0 && timeSinceStopExitS < effectiveRampUpS) ? timeSinceStopExitS / effectiveRampUpS : 1.0;
    const rampFactor = isAtAnyStop ? 0 : stopRampFactor;

    const displayBaseSpeedMph = baseSpeedMph * speedMultiplier;
    const targetSpeedMph = isAtAnyStop ? 0 : Math.max(0, displayBaseSpeedMph * fluctMult * combinedBrakeFactor);
    const currentSpeedMph = Math.max(0, Math.round(targetSpeedMph * rampFactor));

    let displayLat = pos.lat, displayLng = pos.lng;
    if (pos.atStopName && pos.bearing != null) {
      const edgeOffset = destinationPoint(pos.lat, pos.lng, (pos.bearing + 90) % 360, 8);
      displayLat = edgeOffset.lat; displayLng = edgeOffset.lng;
    }

    const snapshot = {
      type: "snapshot", routeId: route.id, timestamp: new Date().toISOString(),
      status: trulyCompleted ? "completed" : route.status === "paused" ? "paused" : isAtAnyStop ? "at_stop" : "in_progress",
      atStopName: pos.atStopName || null,
      atStopRouteStopId: snapshotAtStopRouteStopId,
      stopDwellRemainingS,
      distanceTraveledM: pos.distanceTraveledM,
      progressPercent: pos.progressPercent, lat: displayLat, lng: displayLng,
      bearing: pos.bearing, speedMph: currentSpeedMph,
    };

    broadcastQueue.push({ tokens: cache.shareTokens, routeId: route.id, snapshot });

    if (trulyCompleted) {
      completionGraceMap.delete(route.id);
      wasAtStopMap.delete(route.id);
      lastStopExitSMap.delete(route.id);
      lastKnownDistM.delete(route.id);
      resumeFromPositionSet.delete(route.id);
      invalidateLocalCache(route.id);
      completions.push({ routeId: route.id, elapsedMs: totalElapsedMs, distM: pos.distanceTraveledM, prog: pos.progressPercent });
    } else if (tickCount % DB_SAVE_INTERVAL_TICKS === 0) {
      positionUpdates.push({ routeId: route.id, distM: pos.distanceTraveledM, prog: pos.progressPercent });
    }
  }

  for (const { tokens, routeId, snapshot } of broadcastQueue) {
    for (const token of tokens) broadcastToToken(token, snapshot);
    broadcastToRoute(routeId, snapshot);
  }

  await Promise.all([bulkSavePositions(positionUpdates), bulkCompleteRoutes(completions)]);
}

// ---------------------------------------------------------------------------
// Cache eviction
// ---------------------------------------------------------------------------
const CACHE_EVICT_TICKS = 30;
const CACHE_TTL_TICKS = 150;

function evictStaleCache() {
  for (const [routeId, entry] of routeCache) {
    if (tickCount - entry.lastAccessedTick > CACHE_TTL_TICKS) routeCache.delete(routeId);
  }
}

// ---------------------------------------------------------------------------
// Listen for messages from the main thread
// ---------------------------------------------------------------------------
parentPort.on("message", (msg: { type: string; routeId?: number; oldMult?: number; newMult?: number }) => {
  if (msg.type === "invalidate_cache" && msg.routeId != null) {
    invalidateLocalCache(msg.routeId);
  } else if (msg.type === "resume_from_position" && msg.routeId != null) {
    resumeFromPositionSet.add(msg.routeId);
    if (msg.oldMult != null && msg.newMult != null) {
      resumeMetadataMap.set(msg.routeId, { oldMult: msg.oldMult, newMult: msg.newMult });
    }
  }
});

// ---------------------------------------------------------------------------
// Start the loop
// ---------------------------------------------------------------------------
console.log("[SimWorker] Starting simulation engine worker");
setInterval(() => {
  tick().catch(err => console.error("[SimWorker] Tick error:", err));
  if (tickCount % CACHE_EVICT_TICKS === 0) evictStaleCache();
}, TICK_INTERVAL_MS);
