import { useEffect, useState, useRef } from "react";
import { useParams } from "wouter";
import Map, { Marker, Source, Layer, MapRef } from "react-map-gl";
import mapboxgl from "mapbox-gl";
import 'mapbox-gl/dist/mapbox-gl.css';
import { Truck, Navigation, AlertTriangle, CheckCircle2 } from "lucide-react";
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
    query: { queryKey: getGetPublicTrackQueryKey(token || ""), enabled: !!token, retry: false }
  });

  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [wsError, setWsError] = useState(false);

  useEffect(() => {
    if (!token || isError || route?.status === 'completed' || route?.status === 'expired') return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/public/ws/track/${token}`;
    
    let ws: WebSocket;
    
    const connect = () => {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'snapshot' || data.lat) {
            setSnapshot(data);
          }
        } catch (err) {}
      };
      ws.onclose = () => {
        setWsError(true);
        // Simple reconnect backoff
        setTimeout(connect, 3000);
      };
      ws.onerror = () => setWsError(true);
      ws.onopen = () => setWsError(false);
    };

    connect();
    return () => {
      if (ws) ws.close();
    };
  }, [token, isError, route?.status]);

  // Merge initial snapshot from REST with live WS updates
  const activeSnapshot = snapshot || route?.snapshot;

  useEffect(() => {
    if (route && mapRef.current) {
      const bounds = new mapboxgl.LngLatBounds(
        [route.startLng, route.startLat], 
        [route.endLng, route.endLat]
      );
      route.polyline.forEach(c => bounds.extend(c as [number, number]));
      mapRef.current.fitBounds(bounds, { padding: 80, duration: 1000 });
    }
  }, [route, mapboxToken]);

  if (isLoading) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div></div>;

  if (isError || !route) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center border border-slate-100">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Tracking Unavailable</h1>
          <p className="text-slate-500">No active route found. This tracking link is invalid, expired, or no longer available.</p>
        </div>
      </div>
    );
  }

  if (route.status === 'completed' || activeSnapshot?.status === 'completed') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-10 rounded-3xl shadow-xl max-w-md w-full text-center border border-slate-100">
          <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-3">Delivery Complete!</h1>
          <p className="text-slate-500">This tracking session has ended. The truck has successfully reached its final destination.</p>
        </div>
      </div>
    );
  }

  const geojsonLine: GeoJSON.Feature<GeoJSON.LineString> = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: route.polyline }
  };

  const progress = activeSnapshot ? Math.min(100, Math.max(0, activeSnapshot.progressPercent)) : 0;

  return (
    <div className="h-screen w-full relative bg-slate-100 flex flex-col">
      {/* Header overlay */}
      <header className="absolute top-0 inset-x-0 z-10 bg-gradient-to-b from-black/50 to-transparent pt-6 pb-12 px-6 flex justify-between items-start pointer-events-none">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-lg">
            <Truck className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-white font-display font-bold text-2xl drop-shadow-md">TrackTruck Live</h1>
        </div>
        
        {wsError && (
          <div className="bg-red-500/90 backdrop-blur-md text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg flex items-center gap-2 pointer-events-auto">
            <AlertTriangle className="w-4 h-4" /> Reconnecting to live feed...
          </div>
        )}
      </header>

      {/* Map */}
      <div className="flex-1 relative">
        {mapboxToken && (
          <Map
            ref={mapRef}
            mapboxAccessToken={mapboxToken}
            initialViewState={{ longitude: route.startLng, latitude: route.startLat, zoom: 6 }}
            mapStyle="mapbox://styles/mapbox/navigation-day-v1"
          >
            <Source type="geojson" data={geojsonLine}>
              <Layer 
                id="route-line" 
                type="line" 
                paint={{ 'line-color': '#4F46E5', 'line-width': 6, 'line-opacity': 0.7 }} 
              />
            </Source>

            <Marker longitude={route.startLng} latitude={route.startLat} anchor="bottom">
              <div className="w-4 h-4 bg-black rounded-full border-2 border-white shadow-md" />
            </Marker>

            <Marker longitude={route.endLng} latitude={route.endLat} anchor="bottom">
              <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white border-2 border-white shadow-md">
                <Navigation className="w-3 h-3 fill-current" />
              </div>
            </Marker>

            {route.stops.map((stop, i) => (
              <Marker key={i} longitude={stop.lng} latitude={stop.lat} anchor="center">
                <div className="w-3 h-3 bg-white border-2 border-primary rounded-full shadow-sm" />
              </Marker>
            ))}

            {/* Live Truck Marker */}
            {activeSnapshot?.lat && activeSnapshot?.lng && (
              <Marker 
                longitude={activeSnapshot.lng} 
                latitude={activeSnapshot.lat} 
                anchor="center"
                style={{ transition: 'transform 3s linear' }}
              >
                <div className="relative">
                  <div className="absolute inset-0 bg-primary rounded-full animate-ping opacity-20 scale-150"></div>
                  <div className="w-10 h-10 bg-primary text-white rounded-full flex items-center justify-center shadow-xl border-2 border-white relative z-10"
                       style={{ transform: `rotate(${activeSnapshot.bearing || 0}deg)` }}>
                    <Navigation className="w-5 h-5 fill-current" />
                  </div>
                </div>
              </Marker>
            )}
          </Map>
        )}
      </div>

      {/* Bottom Panel */}
      <div className="absolute bottom-6 inset-x-6 z-10 pointer-events-none">
        <div className="max-w-3xl mx-auto bg-white/90 backdrop-blur-xl rounded-3xl p-6 shadow-2xl border border-white pointer-events-auto">
          <div className="flex justify-between items-end mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="relative flex h-3 w-3">
                  {route.status === 'in_progress' && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                  <span className={`relative inline-flex rounded-full h-3 w-3 ${route.status === 'in_progress' ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                </span>
                <span className="text-sm font-bold uppercase tracking-wider text-slate-500">
                  {route.status.replace('_', ' ')}
                </span>
              </div>
              <h2 className="text-2xl font-bold text-slate-900">{route.routeName}</h2>
            </div>
            
            <div className="text-right">
              <p className="text-sm text-slate-500 mb-1">Distance Covered</p>
              <p className="text-xl font-bold text-slate-900">
                {activeSnapshot ? (activeSnapshot.distanceTraveledM / 1000).toFixed(1) : "0.0"} <span className="text-sm font-normal text-slate-500">km</span>
              </p>
            </div>
          </div>

          <div className="relative w-full h-3 bg-slate-100 rounded-full overflow-hidden">
            <div 
              className="absolute left-0 top-0 h-full bg-primary transition-all duration-1000 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-2 text-xs font-semibold text-slate-400">
            <span>Start</span>
            <span>{progress.toFixed(0)}%</span>
            <span>Destination</span>
          </div>
        </div>
        
        <div className="text-center mt-4 pointer-events-auto">
          <a href="#" className="text-xs font-medium text-slate-600 hover:text-primary bg-white/80 px-3 py-1.5 rounded-full shadow-sm">Contact Support</a>
        </div>
      </div>
    </div>
  );
}
