import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "wouter";
import Map, { Marker, MapRef } from "react-map-gl";
import mapboxgl from "mapbox-gl";
import 'mapbox-gl/dist/mapbox-gl.css';
import { Truck, AlertTriangle, CheckCircle2, MapPin, Clock, Map as MapIcon, Gauge } from "lucide-react";
import { useAppStore } from "@/store/use-app-store";
import { useGetPublicTrack, getGetPublicTrackQueryKey } from "@workspace/api-client-react";

interface SnapshotData {
  type?: string;
  routeId: number;
  timestamp: string;
  status: string;
  atStopName: string | null;
  distanceTraveledM: number;
  progressPercent: number;
  lat: number | null;
  lng: number | null;
  bearing: number | null;
  speedKmh?: number;
}

export default function PublicTracking() {
  const { token } = useParams<{ token: string }>();
  const { mapboxToken } = useAppStore();
  const mapRef = useRef<MapRef>(null);

  const { data: route, isLoading, isError, refetch: refetchRoute } = useGetPublicTrack(token || "", {
    query: { queryKey: getGetPublicTrackQueryKey(token || ""), enabled: !!token, retry: false },
  });

  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  // Clear live data if route is not in progress
  useEffect(() => {
    if (route && route.status !== 'in_progress') {
      setSnapshot(null);
      setMarkerPos(null);
      markerPosRef.current = null;
    }
  }, [route?.status]);

  // Smoothly interpolated marker position — animates from previous to new
  // position over one server-tick interval so the truck glides continuously.
  const TICK_MS = 2000;
  const [markerPos, setMarkerPos] = useState<{ lat: number; lng: number; bearing: number } | null>(null);
  const markerPosRef = useRef<{ lat: number; lng: number; bearing: number } | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const lerpBearing = useCallback((from: number, to: number, t: number) => {
    let diff = to - from;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return from + diff * t;
  }, []);

  useEffect(() => {
    if (snapshot?.lat == null || snapshot?.lng == null) {
      setMarkerPos(null);
      markerPosRef.current = null;
      return;
    }
    const target = { lat: snapshot.lat, lng: snapshot.lng, bearing: snapshot.bearing ?? 0 };
    const from = markerPosRef.current ?? target;
    const startTime = performance.now();

    if (animFrameRef.current != null) cancelAnimationFrame(animFrameRef.current);

    const animate = (now: number) => {
      const t = Math.min((now - startTime) / TICK_MS, 1);
      const pos = {
        lat: from.lat + (target.lat - from.lat) * t,
        lng: from.lng + (target.lng - from.lng) * t,
        bearing: lerpBearing(from.bearing, target.bearing, t),
      };
      markerPosRef.current = pos;
      setMarkerPos({ ...pos });
      if (t < 1) animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => { if (animFrameRef.current != null) cancelAnimationFrame(animFrameRef.current); };
  }, [snapshot, lerpBearing]);

  // Keep refetch in a ref so the WS effect doesn't need it as a dependency
  const refetchRef = useRef(refetchRoute);
  useEffect(() => { refetchRef.current = refetchRoute; }, [refetchRoute]);

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
          if (data.type === 'route_updated') {
            // Admin saved an updated route — reload so map shows the new polyline
            refetchRef.current?.();
          } else if (data.lat !== undefined || data.type === 'snapshot') {
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

  // Initial map state: fit to route, or zoom to truck if in_progress
  const [hasInitialView, setHasInitialView] = useState(false);
  useEffect(() => {
    if (!route || !mapRef.current || !mapboxToken || hasInitialView) return;

    const snapshotPos = snapshot || route.snapshot;
    if (snapshotPos?.lat != null && snapshotPos?.lng != null) {
      // Route is live: zoom directly to truck
      mapRef.current.easeTo({
        center: [snapshotPos.lng, snapshotPos.lat],
        zoom: 12,
        duration: 2000,
      });
      setHasInitialView(true);
    } else if (route.polyline.length > 0) {
      // Not started yet: show the whole route
      const bounds = new mapboxgl.LngLatBounds([route.startLng, route.startLat], [route.endLng, route.endLat]);
      route.polyline.forEach(c => bounds.extend(c as [number, number]));
      mapRef.current.fitBounds(bounds, { padding: 80, duration: 1500 });
      setHasInitialView(true);
    }
  }, [route, snapshot, mapboxToken, hasInitialView]);

  const activeSnapshot = snapshot || route?.snapshot;

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
          {/* Status Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`inline-flex w-2 h-2 rounded-full ${isLive ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {route.status.replace('_', ' ')}
                </span>
              </div>
              {activeSnapshot && (route as any).showSpeedPublic !== false && (
                <div className="flex items-center gap-1.5">
                  <Gauge className="w-4 h-4 text-slate-400" />
                  <span className="text-2xl font-bold text-slate-900 tabular-nums">{activeSnapshot.speedKmh ?? 0}</span>
                  <span className="text-sm text-slate-400">km/h</span>
                </div>
              )}
            </div>
          </div>

          {/* Stops */}
          {route.stops.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
              <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" /> Waypoint Stops
              </h3>
              <div className="space-y-2">
                {route.stops.map((stop, i) => {
                  const isCurrentStop = activeSnapshot?.atStopName === stop.name;
                  return (
                    <div key={i} className={`flex items-center gap-3 p-2.5 rounded-xl transition-colors ${isCurrentStop ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'}`}>
                      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center font-bold text-xs shrink-0 ${isCurrentStop ? 'border-amber-400 bg-amber-400 text-white' : 'border-primary/30 bg-white text-primary'}`}>
                        {isCurrentStop ? '●' : i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{stop.name}</p>
                        {isCurrentStop && <p className="text-xs text-amber-600 font-semibold">Truck is here now</p>}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-slate-500 shrink-0">
                        <Clock className="w-3 h-3" /> {stop.durationMinutes}m
                      </div>
                    </div>
                  );
                })}
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
          mapStyle="mapbox://styles/mapbox/streets-v12"
          projection={{ name: 'mercator' }}
        >
          {/* Live Truck — position updated via smooth rAF interpolation */}
          {markerPos && (
            <Marker longitude={markerPos.lng} latitude={markerPos.lat} anchor="center">
              <div className="relative flex items-center justify-center">
                <div className="absolute w-14 h-14 rounded-full bg-primary/30 animate-ping" />
                <div
                  className="relative z-10 drop-shadow-xl"
                  style={{ transform: `rotate(${markerPos.bearing}deg)` }}
                >
                  <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
                    <circle cx="22" cy="22" r="20" fill="#3b3ef4" stroke="white" strokeWidth="2.5" />
                    <path d="M22 9 L29 30 L22 25.5 L15 30 Z" fill="white" />
                  </svg>
                </div>
              </div>
            </Marker>
          )}
        </Map>
      </div>

      {/* Bottom Panel */}
      <div className="absolute bottom-5 inset-x-4 z-10 pointer-events-none">
        <div className="max-w-2xl mx-auto bg-white/95 backdrop-blur-xl rounded-3xl px-5 py-4 shadow-2xl border border-white/50 pointer-events-auto space-y-3">

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                {isLive && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isLive ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {route.status.replace('_', ' ')}
              </span>
            </div>

            {(route as any).showSpeedPublic !== false && (
              <div className="flex items-center gap-1.5 shrink-0">
                <Gauge className="w-4 h-4 text-slate-400" />
                <span className="text-2xl font-bold text-slate-900 tabular-nums">
                  {(activeSnapshot as SnapshotData | null)?.speedKmh ?? 0}
                </span>
                <span className="text-sm font-normal text-slate-400">km/h</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
