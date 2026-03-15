function toRad(deg: number) { return deg * Math.PI / 180; }

export function haversineDistanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export function straightLinePolyline(lat1: number, lng1: number, lat2: number, lng2: number) {
  const distanceM = haversineDistanceM(lat1, lng1, lat2, lng2);
  return {
    polyline: [[lng1, lat1], [lng2, lat2]],
    distanceM,
  };
}

export interface SpeedSegment {
  distanceM: number;
  speedKmh: number;
}

export interface RouteOption {
  polyline: number[][];
  distanceM: number;
  durationS: number;
  speedProfile: SpeedSegment[];
}

/** Max allowed snapping distance: if OSRM moved our start/end more than this,
 *  the route is invalid (different continent / no road connection). */
const MAX_SNAP_M = 50_000; // 50 km

function extractSpeedProfile(legs: any[]): SpeedSegment[] {
  const profile: SpeedSegment[] = [];
  for (const leg of legs) {
    for (const step of leg.steps ?? []) {
      if (step.distance > 0 && step.duration > 0) {
        const speedKmh = (step.distance / step.duration) * 3.6;
        if (isFinite(speedKmh) && speedKmh > 0) {
          profile.push({ distanceM: step.distance, speedKmh });
        }
      }
    }
  }
  return profile;
}

/** Returns true if the route's actual start/end are too far from the requested coords */
function routeIsSnappedFar(
  requestedCoords: number[][], // [lng, lat][]
  routePolyline: number[][]    // [lng, lat][]
): boolean {
  if (routePolyline.length === 0) return true;

  const reqStart = requestedCoords[0];
  const reqEnd = requestedCoords[requestedCoords.length - 1];
  const routeStart = routePolyline[0];
  const routeEnd = routePolyline[routePolyline.length - 1];

  const snapStart = haversineDistanceM(reqStart[1], reqStart[0], routeStart[1], routeStart[0]);
  const snapEnd = haversineDistanceM(reqEnd[1], reqEnd[0], routeEnd[1], routeEnd[0]);

  return snapStart > MAX_SNAP_M || snapEnd > MAX_SNAP_M;
}

/** Returns true if any step in the route uses a ferry (crosses water) */
function routeContainsFerry(legs: any[]): boolean {
  for (const leg of legs) {
    for (const step of leg.steps ?? []) {
      if (step.mode === 'ferry') return true;
    }
  }
  return false;
}

export async function fetchOsrmDirections(
  coordinates: number[][]
): Promise<RouteOption[] | null> {
  if (coordinates.length < 2) return null;

  const coordsString = coordinates.map(c => `${c[0]},${c[1]}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson&steps=true&alternatives=3`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('OSRM request failed');
    const data = await res.json();

    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) return null;

    const validRoutes: RouteOption[] = [];
    for (const route of data.routes) {
      const polyline = route.geometry.coordinates as number[][];

      // Reject routes where OSRM snapped the start/end to a very different location
      if (routeIsSnappedFar(coordinates, polyline)) {
        console.warn('OSRM route rejected: start or end snapped more than 50 km from requested location');
        continue;
      }

      // Reject routes that cross water via ferry
      if (routeContainsFerry(route.legs ?? [])) {
        console.warn('OSRM route rejected: contains ferry crossing');
        continue;
      }

      validRoutes.push({
        polyline,
        distanceM: route.distance as number,
        durationS: route.duration as number,
        speedProfile: extractSpeedProfile(route.legs ?? []),
      });
    }

    return validRoutes.length > 0 ? validRoutes : null;
  } catch (error) {
    console.error('OSRM directions error:', error);
    return null;
  }
}

export async function fetchDirections(
  coordinates: number[][],
  token: string
): Promise<RouteOption[] | null> {
  if (coordinates.length < 2) return null;

  const coordsString = coordinates.map(c => `${c[0]},${c[1]}`).join(';');
  // overview=full returns the complete detailed polyline (not simplified)
  // exclude=ferry ensures Mapbox stays on roads only (no sea crossings)
  // steps=true needed to read step-level annotations
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordsString}?geometries=geojson&overview=full&steps=true&alternatives=true&exclude=ferry&access_token=${token}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      console.error('Mapbox Directions error:', res.status, errBody);
      throw new Error(`Mapbox request failed: ${res.status}`);
    }
    const data = await res.json();

    if (!data.routes || data.routes.length === 0) return null;

    const validRoutes: RouteOption[] = [];
    for (const route of data.routes) {
      const polyline = route.geometry.coordinates as number[][];

      if (routeIsSnappedFar(coordinates, polyline)) {
        console.warn('Mapbox route rejected: snapped too far from requested location');
        continue;
      }

      validRoutes.push({
        polyline,
        distanceM: route.distance as number,
        durationS: route.duration as number,
        speedProfile: [],
      });
    }

    return validRoutes.length > 0 ? validRoutes : null;
  } catch (error) {
    console.error('Directions error:', error);
    return null;
  }
}
