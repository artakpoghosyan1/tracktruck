import { useState, useEffect, useRef } from "react";
import { Link, useLocation, useParams } from "wouter";
import Map, { Marker, Source, Layer, MapRef } from "react-map-gl";
import mapboxgl from "mapbox-gl";
import 'mapbox-gl/dist/mapbox-gl.css';
import { 
  ArrowLeft, Save, CreditCard, Truck, Route as RouteIcon, MapPin, 
  MapPinOff, Flag, GripVertical, Plus, Trash2, Clock
} from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { AdminLayout } from "@/components/layout/AdminLayout";
import { MapboxPrompt } from "@/components/MapboxPrompt";
import { useAppStore } from "@/store/use-app-store";
import { useToast } from "@/hooks/use-toast";
import { fetchDirections } from "@/lib/mapbox-utils";
import { useCreateRoute, useUpdateRoute, useGetRoute, useCreatePayment, getGetRouteQueryKey } from "@workspace/api-client-react";

interface Stop {
  id: string; // temp client ID
  name: string;
  lat: number;
  lng: number;
  durationMinutes: number;
  isDb?: boolean;
  dbId?: number;
}

interface SortableStopItemProps {
  stop: Stop;
  onRemove: (id: string) => void;
  onChangeName: (id: string, val: string) => void;
  onChangeDuration: (id: string, val: number) => void;
}

function SortableStopItem({ stop, onRemove, onChangeName, onChangeDuration }: SortableStopItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: stop.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className="flex gap-2 items-center bg-card border border-border rounded-xl p-3 shadow-sm group">
      <div {...attributes} {...listeners} className="cursor-grab p-1 text-muted-foreground hover:text-foreground">
        <GripVertical className="w-5 h-5" />
      </div>
      <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
        <MapPin className="w-4 h-4" />
      </div>
      <div className="flex-1 space-y-2">
        <input 
          type="text" 
          value={stop.name} 
          onChange={(e) => onChangeName(stop.id, e.target.value)}
          className="w-full bg-transparent font-medium outline-none text-sm placeholder:font-normal"
          placeholder="Stop name"
        />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          <input 
            type="number" 
            value={stop.durationMinutes} 
            onChange={(e) => onChangeDuration(stop.id, Number(e.target.value))}
            className="w-12 bg-transparent outline-none border-b border-dashed border-muted-foreground/30 focus:border-primary text-center"
            min={1}
          />
          min
        </div>
      </div>
      <button onClick={() => onRemove(stop.id)} className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

export default function RouteBuilder() {
  const params = useParams();
  const routeId = params.id ? parseInt(params.id) : undefined;
  const [, setLocation] = useLocation();
  const { mapboxToken } = useAppStore();
  const { toast } = useToast();
  const mapRef = useRef<MapRef>(null);

  const [name, setName] = useState("");
  const [speed, setSpeed] = useState(60);
  const [start, setStart] = useState<[number, number] | null>(null);
  const [end, setEnd] = useState<[number, number] | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [polyline, setPolyline] = useState<number[][]>([]);
  const [distance, setDistance] = useState(0);
  const [duration, setDuration] = useState(0);
  const [mapMode, setMapMode] = useState<'idle'|'start'|'end'|'stop'>('idle');

  const { data: existingRoute } = useGetRoute(routeId || 0, { query: { queryKey: getGetRouteQueryKey(routeId || 0), enabled: !!routeId } });
  const createMut = useCreateRoute();
  const updateMut = useUpdateRoute();
  const paymentMut = useCreatePayment();

  // Load existing data
  useEffect(() => {
    if (existingRoute) {
      setName(existingRoute.name);
      setSpeed(existingRoute.truckSpeedKmh);
      setStart([existingRoute.startLng, existingRoute.startLat]);
      setEnd([existingRoute.endLng, existingRoute.endLat]);
      setPolyline(existingRoute.polyline || []);
      setDistance(existingRoute.distanceM || 0);
      setDuration(existingRoute.estimatedDurationS || 0);
      setStops(existingRoute.stops.map(s => ({
        id: `db-${s.id}`,
        name: s.name,
        lat: s.lat,
        lng: s.lng,
        durationMinutes: s.durationMinutes,
        isDb: true,
        dbId: s.id
      })));
    }
  }, [existingRoute]);

  // Recalculate route whenever points change
  useEffect(() => {
    const updateRouteGeom = async () => {
      if (!start || !end || !mapboxToken) return;
      const coords = [start, ...stops.map(s => [s.lng, s.lat]), end];
      const res = await fetchDirections(coords, mapboxToken);
      if (res) {
        setPolyline(res.polyline);
        setDistance(res.distanceM);
        setDuration(res.durationS);
        if (mapRef.current) {
          // Fit bounds
          const bounds = new mapboxgl.LngLatBounds(start, start);
          coords.forEach(c => bounds.extend(c as [number, number]));
          mapRef.current.fitBounds(bounds, { padding: 50, duration: 1000 });
        }
      }
    };
    const t = setTimeout(updateRouteGeom, 500);
    return () => clearTimeout(t);
  }, [start, end, stops, mapboxToken]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setStops((items) => {
        const oldIndex = items.findIndex(i => i.id === active.id);
        const newIndex = items.findIndex(i => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleMapClick = (e: mapboxgl.MapLayerMouseEvent) => {
    if (mapMode === 'idle') return;
    const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    
    if (mapMode === 'start') setStart(pt);
    if (mapMode === 'end') setEnd(pt);
    if (mapMode === 'stop') {
      setStops([...stops, { 
        id: `client-${Date.now()}`, 
        name: `Stop ${stops.length + 1}`, 
        lat: pt[1], lng: pt[0], 
        durationMinutes: 15 
      }]);
    }
    setMapMode('idle');
  };

  const handleSave = async (isActivate: boolean) => {
    if (!name || !start || !end) {
      toast({ title: "Validation Error", description: "Name, start, and end locations are required.", variant: "destructive" });
      return;
    }

    try {
      const payload = {
        name,
        startLat: start[1], startLng: start[0],
        endLat: end[1], endLng: end[0],
        truckSpeedKmh: speed,
        polyline,
      };

      let savedRoute;
      if (routeId) {
        savedRoute = await updateMut.mutateAsync({ id: routeId, data: payload });
      } else {
        savedRoute = await createMut.mutateAsync({ data: payload });
        // Create stops sequentially
        for (let i=0; i<stops.length; i++) {
           await fetch(`/api/routes/${savedRoute.id}/stops`, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('tracktruck_token')}` },
             body: JSON.stringify({ name: stops[i].name, lat: stops[i].lat, lng: stops[i].lng, durationMinutes: stops[i].durationMinutes, sortOrder: i })
           });
        }
      }

      if (isActivate) {
        // Trigger payment flow
        const payRes = await paymentMut.mutateAsync({ data: { routeId: savedRoute.id, amount: 5000 } });
        // Mock gateway automatically completes.
        toast({ title: "Route Activated!", description: "Payment successful. Route is now ready." });
      } else {
        toast({ title: "Draft Saved", description: "Route saved successfully." });
      }

      setLocation('/admin');
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save route";
      toast({ title: "Error saving route", description: message, variant: "destructive" });
    }
  };

  const formatDistance = (m: number) => (m / 1000).toFixed(1) + " km";
  const formatDuration = (s: number) => {
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    return `${hrs}h ${mins}m`;
  };

  const geojsonLine: GeoJSON.Feature<GeoJSON.LineString> = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: polyline }
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <MapboxPrompt />
      
      {/* Header */}
      <header className="flex-shrink-0 bg-card border-b border-border/60 px-6 py-4 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-4">
          <Link href="/admin" className="p-2 -ml-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl font-bold font-display">{routeId ? "Edit Route" : "Create New Route"}</h1>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => handleSave(false)}
            disabled={createMut.isPending || updateMut.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-xl font-semibold transition-colors"
          >
            <Save className="w-4 h-4" /> Save Draft
          </button>
          <button 
            onClick={() => handleSave(true)}
            disabled={createMut.isPending || updateMut.isPending || paymentMut.isPending}
            className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-primary to-blue-500 text-white rounded-xl font-bold shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5 transition-all"
          >
            <CreditCard className="w-4 h-4" /> Activate Route
          </button>
        </div>
      </header>

      {/* Main split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <aside className="w-[400px] flex-shrink-0 bg-background border-r border-border/60 flex flex-col overflow-y-auto">
          <div className="p-6 space-y-6">
            
            <div className="space-y-4">
              <div>
                <label className="text-sm font-semibold text-foreground mb-1 block">Route Name</label>
                <input 
                  type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Yerevan to Tbilisi Express"
                  className="w-full px-4 py-2.5 rounded-xl bg-card border border-border focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-foreground mb-1 block flex justify-between">
                  <span>Truck Speed</span>
                  <span className="text-primary">{speed} km/h</span>
                </label>
                <input 
                  type="range" min={30} max={120} step={5}
                  value={speed} onChange={(e) => setSpeed(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
            </div>

            <hr className="border-border/60" />

            <div className="space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">Map Controls</h3>
              <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={() => setMapMode(mapMode === 'start' ? 'idle' : 'start')}
                  className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${mapMode === 'start' ? 'border-primary bg-primary/5 text-primary' : 'border-border bg-card hover:bg-muted text-muted-foreground'}`}
                >
                  <MapPinOff className="w-5 h-5 mb-1" />
                  <span className="text-xs font-semibold">Set Start</span>
                </button>
                <button 
                  onClick={() => setMapMode(mapMode === 'end' ? 'idle' : 'end')}
                  className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${mapMode === 'end' ? 'border-primary bg-primary/5 text-primary' : 'border-border bg-card hover:bg-muted text-muted-foreground'}`}
                >
                  <Flag className="w-5 h-5 mb-1" />
                  <span className="text-xs font-semibold">Set End</span>
                </button>
              </div>
              <button 
                onClick={() => setMapMode(mapMode === 'stop' ? 'idle' : 'stop')}
                className={`w-full flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${mapMode === 'stop' ? 'border-primary bg-primary/5 text-primary' : 'border-dashed border-border bg-transparent hover:bg-muted text-foreground'}`}
              >
                <Plus className="w-4 h-4" /> Add Stop
              </button>
            </div>

            {stops.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Stops</h3>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={stops.map(s => s.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                      {stops.map(stop => (
                        <SortableStopItem 
                          key={stop.id} 
                          stop={stop} 
                          onRemove={(id: string) => setStops(s => s.filter(x => x.id !== id))}
                          onChangeName={(id: string, val: string) => setStops(s => s.map(x => x.id === id ? {...x, name: val} : x))}
                          onChangeDuration={(id: string, val: number) => setStops(s => s.map(x => x.id === id ? {...x, durationMinutes: val} : x))}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>
            )}
            
            {(distance > 0 || duration > 0) && (
              <div className="bg-primary/5 border border-primary/20 rounded-2xl p-5 mt-6">
                <h3 className="text-sm font-semibold text-primary mb-3">Route Summary</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Total Distance</p>
                    <p className="text-lg font-bold text-foreground">{formatDistance(distance)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Base ETA (Driving)</p>
                    <p className="text-lg font-bold text-foreground">{formatDuration(duration)}</p>
                  </div>
                </div>
              </div>
            )}

          </div>
        </aside>

        {/* Map Area */}
        <main className="flex-1 relative bg-slate-100">
          {mapboxToken ? (
            <Map
              ref={mapRef}
              mapboxAccessToken={mapboxToken}
              initialViewState={{ longitude: 44.5152, latitude: 40.1872, zoom: 10 }}
              mapStyle="mapbox://styles/mapbox/light-v11"
              onClick={handleMapClick}
              cursor={mapMode !== 'idle' ? 'crosshair' : 'grab'}
            >
              {start && (
                <Marker longitude={start[0]} latitude={start[1]} anchor="bottom">
                  <div className="w-8 h-8 bg-black rounded-full flex items-center justify-center text-white shadow-xl shadow-black/30 border-2 border-white">
                    <MapPinOff className="w-4 h-4" />
                  </div>
                </Marker>
              )}
              {end && (
                <Marker longitude={end[0]} latitude={end[1]} anchor="bottom">
                  <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white shadow-xl shadow-primary/30 border-2 border-white">
                    <Flag className="w-4 h-4" />
                  </div>
                </Marker>
              )}
              {stops.map((stop, i) => (
                <Marker key={stop.id} longitude={stop.lng} latitude={stop.lat} anchor="bottom">
                  <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center text-primary shadow-lg border-2 border-primary font-bold text-xs">
                    {i+1}
                  </div>
                </Marker>
              ))}

              {polyline.length > 0 && (
                <Source type="geojson" data={geojsonLine}>
                  <Layer 
                    id="route-line" 
                    type="line" 
                    paint={{ 
                      'line-color': 'hsl(239 84% 67%)', 
                      'line-width': 5,
                      'line-opacity': 0.8
                    }} 
                  />
                </Source>
              )}
            </Map>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-slate-100">
              <p className="text-muted-foreground font-medium">Please enter Mapbox token to view map.</p>
            </div>
          )}

          {/* Floating Instructions */}
          {mapMode !== 'idle' && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-foreground text-background px-6 py-3 rounded-full font-semibold shadow-2xl animate-in slide-in-from-top-4 flex items-center gap-2">
              <RouteIcon className="w-5 h-5" />
              Click on the map to place the {mapMode} point
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
