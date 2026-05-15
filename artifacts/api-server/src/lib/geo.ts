const EARTH_RADIUS_M = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export interface PositionResult {
  lat: number;
  lng: number;
  bearing: number;
  distanceTraveledM: number;
  progressPercent: number;
  completed: boolean;
}

export function positionAlongPolyline(
  coords: number[][],
  distanceTraveledM: number,
): PositionResult {
  if (coords.length === 0) {
    return { lat: 0, lng: 0, bearing: 0, distanceTraveledM: 0, progressPercent: 0, completed: false };
  }

  let totalDistance = 0;
  const segmentDistances: number[] = [];

  for (let i = 1; i < coords.length; i++) {
    const d = haversineM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    segmentDistances.push(d);
    totalDistance += d;
  }

  if (totalDistance === 0) {
    return {
      lat: coords[0][1],
      lng: coords[0][0],
      bearing: 0,
      distanceTraveledM: 0,
      progressPercent: 0,
      completed: false,
    };
  }

  if (distanceTraveledM >= totalDistance) {
    const last = coords[coords.length - 1];
    return {
      lat: last[1],
      lng: last[0],
      bearing: 0,
      distanceTraveledM: totalDistance,
      progressPercent: 100,
      completed: true,
    };
  }

  let accumulated = 0;
  for (let i = 0; i < segmentDistances.length; i++) {
    const segLen = segmentDistances[i];
    if (accumulated + segLen >= distanceTraveledM) {
      const frac = (distanceTraveledM - accumulated) / segLen;
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const lat = p1[1] + (p2[1] - p1[1]) * frac;
      const lng = p1[0] + (p2[0] - p1[0]) * frac;
      const b = bearing(p1[1], p1[0], p2[1], p2[0]);
      return {
        lat,
        lng,
        bearing: b,
        distanceTraveledM,
        progressPercent: (distanceTraveledM / totalDistance) * 100,
        completed: false,
      };
    }
    accumulated += segLen;
  }

  const last = coords[coords.length - 1];
  return {
    lat: last[1],
    lng: last[0],
    bearing: 0,
    distanceTraveledM: totalDistance,
    progressPercent: 100,
    completed: true,
  };
}

export function totalPolylineDistance(coords: number[][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  }
  return total;
}

/** Cumulative polyline distance (meters) at the closest point to (lat, lng) on the route. */
export function distanceAlongPolylineAtPoint(
  polyline: number[][],
  targetLat: number,
  targetLng: number,
): number {
  if (polyline.length === 0) return 0;
  if (polyline.length === 1) return 0;

  let bestDistSq = Infinity;
  let bestAlongM = 0;
  let cumDist = 0;

  for (let i = 0; i < polyline.length - 1; i++) {
    const ax = polyline[i][0], ay = polyline[i][1];
    const bx = polyline[i + 1][0], by = polyline[i + 1][1];
    const segLen = haversineM(ay, ax, by, bx);
    const abx = bx - ax, aby = by - ay;
    const lenSq = abx * abx + aby * aby;
    const t = lenSq > 0
      ? Math.max(0, Math.min(1, ((targetLng - ax) * abx + (targetLat - ay) * aby) / lenSq))
      : 0;
    const snapLng = ax + t * abx;
    const snapLat = ay + t * aby;
    const distSq = (targetLng - snapLng) ** 2 + (targetLat - snapLat) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestAlongM = cumDist + segLen * t;
    }
    cumDist += segLen;
  }
  return bestAlongM;
}
