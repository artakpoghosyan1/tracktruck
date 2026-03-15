import { useEffect, useState, useRef } from "react";
import { useParams } from "wouter";
import Map, { Marker, Source, Layer, MapRef } from "react-map-gl";
import mapboxgl from "mapbox-gl";
import 'mapbox-gl/dist/mapbox-gl.css';
import { Truck, Navigation, AlertTriangle, CheckCircle2, MapPin, Clock, Map as MapIcon } from "lucide-react";
import { useAppStore } from "@/store/use-app-store";
import { useGetPublicTrack, getGetPublicTrackQueryKey } from "@workspace/api-client-react";

interface SnapshotData {
  type?: string;
  routeId: number;
  timestamp: string;
  status: string;
  distanceTraveledM: number;
  progressPercent: number;
  lat: number | null;
  lng: number | null;
  bearing: number | null;
}

export default function PublicTracking() {
  const { token } = useParams<{ token: string }>();
  const { mapboxToken } = useAppStore();
  const mapRef = useRef<MapRef>(null);

  const { data: route, isLoading, isError } = useGetPublicTrack(token || "", {
    query: { queryKey: getGetPublicTrackQueryKey(token || ""), enabled: !!token, retry: false },
  });

  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    if (!token || isError) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/public/ws/track/${token}`;
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => setWsConnected(true);
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.lat !== undefined || data.type === 'snapshot') {
            setSnapshot(data);
          }
        } catch { }
      };
      ws.onclose = () => {
        setWsConnected(false);
        reconnectTimer = setTimeout(connect, 4000);
      };
      ws.onerror = () => setWsConnected(false);
    };

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [token, isError]);

  // Fit map to route bounds
  useEffect(() => {
    if (route && mapRef.current && mapboxToken) {
      const bounds = new mapboxgl.LngLatBounds([route.startLng, route.startLat], [route.endLng, route.endLat]);
      route.polyline.forEach(c => bounds.extend(c as [number, number]));
      mapRef.current.fitBounds(bounds, { padding: 80, duration: 1000 });
    }
  }, [route, mapboxToken]);

  const activeSnapshot = snapshot || route?.snapshot;
  const progress = activeSnapshot ? Math.min(100, Math.max(0, activeSnapshot.progressPercent)) : 0;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isError || !route) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center border border-slate-100">
          <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-5">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Tracking Unavailable</h1>
          <p className="text-slate-500 text-sm">
            This tracking link is invalid, expired, or no longer active.
            Check with your dispatcher for an updated link.
          </p>
        </div>
      </div>
    );
  }

  if (route.status === 'completed' || activeSnapshot?.status === 'completed') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-10 rounded-3xl shadow-xl max-w-md w-full text-center border border-slate-100">
          <div className="w-20 h-20 bg-emerald-100 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-3">Delivery Complete!</h1>
          <p className="text-slate-500">The truck has successfully reached its destination.</p>
        </div>
      </div>
    );
  }

  const geojsonLine: GeoJSON.Feature<GeoJSON.LineString> = {
    type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: route.polyline },
  };

  const isLive = route.status === 'in_progress';

  // --- No Mapbox Token: text-only view ---
  if (!mapboxToken) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col">
        {/* Header */}
        <header className="bg-white border-b border-slate-100 px-6 py-4 flex items-center gap-3 shadow-sm">
          <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center">
            <Truck className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-bold text-slate-900 text-base leading-tight">TrackTruck Live</h1>
            <p className="text-xs text-slate-500">Route Tracking</p>
          </div>
          {!wsConnected && (
            <div className="ml-auto flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-full">
              <AlertTriangle className="w-3.5 h-3.5" /> Reconnecting...
            </div>
          )}
          {wsConnected && isLive && (
            <div className="ml-auto flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Live
            </div>
          )}
        </header>

        <div className="flex-1 p-5 max-w-xl mx-auto w-full space-y-4">
          {/* Route Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-flex w-2 h-2 rounded-full ${isLive ? 'bg-emerald-500' : 'bg-amber-400'}`} />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                {route.status.replace('_', ' ')}
              </span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-4">{route.routeName}</h2>

            {/* Progress */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-semibold text-slate-500">
                <span>Start</span>
                <span className="text-primary">{progress.toFixed(0)}% complete</span>
                <span>Destination</span>
              </div>
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-1000"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {activeSnapshot && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-slate-500 mb-0.5">Covered</p>
                  <p className="text-lg font-bold text-slate-900">
                    {(activeSnapshot.distanceTraveledM / 1000).toFixed(1)}
                    <span className="text-sm font-normal text-slate-400 ml-1">km</span>
                  </p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-slate-500 mb-0.5">Progress</p>
                  <p className="text-lg font-bold text-slate-900">
                    {progress.toFixed(1)}<span className="text-sm font-normal text-slate-400">%</span>
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Stops */}
          {route.stops.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
              <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" /> Waypoint Stops
              </h3>
              <div className="space-y-2">
                {route.stops.map((stop, i) => (
                  <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50">
                    <div className="w-6 h-6 rounded-full border-2 border-primary/30 bg-white flex items-center justify-center text-primary font-bold text-xs shrink-0">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{stop.name}</p>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-slate-500 shrink-0">
                      <Clock className="w-3 h-3" /> {stop.durationMinutes}m
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No map notice */}
          <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-5 flex items-center gap-4">
            <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center shrink-0">
              <MapIcon className="w-5 h-5 text-slate-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700">Map view unavailable</p>
              <p className="text-xs text-slate-400">The dispatcher hasn't enabled map display for this tracking link.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Full map view with Mapbox ---
  return (
    <div className="h-screen w-full relative bg-slate-100 flex flex-col overflow-hidden">
      {/* Header overlay */}
      <header className="absolute top-0 inset-x-0 z-10 bg-gradient-to-b from-black/60 to-transparent pt-5 pb-14 px-5 flex justify-between items-start pointer-events-none">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-lg">
            <Truck className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg leading-tight drop-shadow-md">TrackTruck Live</h1>
            <p className="text-white/70 text-xs">{route.routeName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          {isLive && wsConnected && (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-500/90 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-lg">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" /> Live
            </div>
          )}
          {!wsConnected && (
            <div className="flex items-center gap-1.5 text-xs text-white bg-black/50 backdrop-blur-sm px-3 py-1.5 rounded-full">
              <AlertTriangle className="w-3.5 h-3.5" /> Reconnecting...
            </div>
          )}
        </div>
      </header>

      {/* Map */}
      <div className="flex-1 relative">
        <Map
          ref={mapRef}
          mapboxAccessToken={mapboxToken}
          initialViewState={{ longitude: route.startLng, latitude: route.startLat, zoom: 6 }}
          mapStyle="mapbox://styles/mapbox/navigation-day-v1"
        >
          <Source type="geojson" data={geojsonLine}>
            <Layer
              id="route-line-bg"
              type="line"
              paint={{ 'line-color': '#94a3b8', 'line-width': 6, 'line-opacity': 0.4 }}
            />
            <Layer
              id="route-line"
              type="line"
              paint={{ 'line-color': '#4F46E5', 'line-width': 5, 'line-opacity': 0.85 }}
            />
          </Source>

          {/* Start */}
          <Marker longitude={route.startLng} latitude={route.startLat} anchor="center">
            <div className="w-4 h-4 bg-black rounded-full border-2 border-white shadow-md" />
          </Marker>

          {/* End */}
          <Marker longitude={route.endLng} latitude={route.endLat} anchor="center">
            <div className="w-7 h-7 bg-red-500 rounded-full flex items-center justify-center text-white border-2 border-white shadow-lg">
              <Navigation className="w-3.5 h-3.5 fill-current" />
            </div>
          </Marker>

          {/* Stops */}
          {route.stops.map((stop, i) => (
            <Marker key={i} longitude={stop.lng} latitude={stop.lat} anchor="center">
              <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center text-primary shadow-md border-2 border-primary font-bold text-xs">
                {i + 1}
              </div>
            </Marker>
          ))}

          {/* Live Truck */}
          {activeSnapshot?.lat != null && activeSnapshot?.lng != null && (
            <Marker
              longitude={activeSnapshot.lng}
              latitude={activeSnapshot.lat}
              anchor="center"
            >
              <div className="relative">
                <div className="absolute inset-0 bg-primary rounded-full animate-ping opacity-25 scale-150" />
                <div
                  className="w-11 h-11 bg-primary text-white rounded-full flex items-center justify-center shadow-xl border-2 border-white relative z-10 transition-transform"
                  style={{ transform: `rotate(${activeSnapshot.bearing || 0}deg)` }}
                >
                  <Truck className="w-5 h-5" />
                </div>
              </div>
            </Marker>
          )}
        </Map>
      </div>

      {/* Bottom Panel */}
      <div className="absolute bottom-5 inset-x-4 z-10 pointer-events-none">
        <div className="max-w-2xl mx-auto bg-white/95 backdrop-blur-xl rounded-3xl p-5 shadow-2xl border border-white/50 pointer-events-auto">
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="relative flex h-2.5 w-2.5">
                  {isLive && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isLive ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  {route.status.replace('_', ' ')}
                </span>
              </div>
              <h2 className="text-lg font-bold text-slate-900">{route.routeName}</h2>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500 mb-0.5">Distance Covered</p>
              <p className="text-xl font-bold text-slate-900">
                {activeSnapshot ? (activeSnapshot.distanceTraveledM / 1000).toFixed(1) : "0.0"}
                <span className="text-sm font-normal text-slate-400 ml-1">km</span>
              </p>
            </div>
          </div>

          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary to-blue-400 rounded-full transition-all duration-1000 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-xs font-semibold text-slate-400">
            <span>Start</span>
            <span className="text-primary">{progress.toFixed(0)}%</span>
            <span>Destination</span>
          </div>
        </div>
      </div>
    </div>
  );
}
