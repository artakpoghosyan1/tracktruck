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
