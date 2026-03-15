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

export async function fetchOsrmDirections(
  coordinates: number[][] // array of [lng, lat]
): Promise<{
  polyline: number[][];
  distanceM: number;
  durationS: number;
  speedProfile: SpeedSegment[];
} | null> {
  if (coordinates.length < 2) return null;

  const coordsString = coordinates.map(c => `${c[0]},${c[1]}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson&steps=true&annotations=speed`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('OSRM request failed');
    const data = await res.json();

    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) return null;

    const route = data.routes[0];
    const polyline = route.geometry.coordinates as number[][];
    const distanceM = route.distance as number;
    const durationS = route.duration as number;

    const speedProfile: SpeedSegment[] = [];
    for (const leg of route.legs) {
      for (const step of leg.steps) {
        if (step.distance > 0 && step.duration > 0) {
          const speedMs = step.distance / step.duration;
          const speedKmh = speedMs * 3.6;
          if (isFinite(speedKmh) && speedKmh > 0) {
            speedProfile.push({
              distanceM: step.distance,
              speedKmh,
            });
          }
        }
      }
    }

    return { polyline, distanceM, durationS, speedProfile };
  } catch (error) {
    console.error('OSRM directions error:', error);
    return null;
  }
}

export async function fetchDirections(
  coordinates: number[][], // array of [lng, lat]
  token: string
) {
  if (coordinates.length < 2) return null;

  const coordsString = coordinates.map(c => `${c[0]},${c[1]}`).join(';');
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordsString}?geometries=geojson&access_token=${token}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch directions');
    const data = await res.json();
    
    if (data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      return {
        polyline: route.geometry.coordinates as number[][],
        distanceM: route.distance as number,
        durationS: route.duration as number,
      };
    }
    return null;
  } catch (error) {
    console.error('Directions error:', error);
    return null;
  }
}
