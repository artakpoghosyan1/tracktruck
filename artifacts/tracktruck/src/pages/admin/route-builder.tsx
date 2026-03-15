import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation, useParams } from "wouter";
import Map, { Marker, Source, Layer, MapRef, Popup } from "react-map-gl";
import mapboxgl from "mapbox-gl";
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  ArrowLeft, Save, CreditCard, Flag, GripVertical,
  Plus, Trash2, Clock, Navigation, Map as MapIcon, Settings,
  MapPin, X, CheckCircle2, Loader2,
} from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { MapboxPrompt } from "@/components/MapboxPrompt";
import { AddressSearch } from "@/components/AddressSearch";
import { useAppStore } from "@/store/use-app-store";
import { useToast } from "@/hooks/use-toast";
import { fetchDirections, fetchOsrmDirections, type RouteOption, type SpeedSegment } from "@/lib/mapbox-utils";
import { useCreateRoute, useUpdateRoute, useGetRoute, useCreatePayment, getGetRouteQueryKey } from "@workspace/api-client-react";

interface RoutePoint { lng: number; lat: number; label: string; }

interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  durationMinutes: number;
  dbId?: number;
}

interface MapClickState {
  lng: number;
  lat: number;
  label: string;
  loading: boolean;
}

async function reverseGeocode(lat: number, lng: number, mapboxToken?: string | null): Promise<string> {
  try {
    if (mapboxToken) {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${mapboxToken}&limit=1`
      );
      const data = await res.json();
      return data.features?.[0]?.place_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } else {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json();
      return data.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

function routeLabel(idx: number, option: RouteOption, allOptions: RouteOption[]): string {
  if (allOptions.length === 1) return "Recommended";
  const shortest = [...allOptions].sort((a, b) => a.distanceM - b.distanceM)[0];
  const fastest = [...allOptions].sort((a, b) => a.durationS - b.durationS)[0];
  if (option === shortest && option === fastest) return "Shortest & Fastest";
  if (option === shortest) return "Shortest";
  if (option === fastest) return "Fastest";
  return `Alternative ${idx}`;
}

function SortableStopItem({ stop, index, onRemove, onChangeName, onChangeDuration }: {
  stop: Stop; index: number;
  onRemove: (id: string) => void;
  onChangeName: (id: string, val: string) => void;
  onChangeDuration: (id: string, val: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: stop.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className="flex gap-2 items-center bg-muted/40 border border-border/60 rounded-xl p-3 group">
      <div {...attributes} {...listeners} className="cursor-grab p-1 text-muted-foreground hover:text-foreground shrink-0">
        <GripVertical className="w-4 h-4" />
      </div>
      <div className="w-6 h-6 rounded-full bg-white border-2 border-primary flex items-center justify-center text-primary font-bold text-xs shrink-0">
        {index + 1}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <input
          type="text"
          value={stop.name}
          onChange={(e) => onChangeName(stop.id, e.target.value)}
          className="w-full bg-transparent font-medium outline-none text-sm placeholder:text-muted-foreground truncate"
          placeholder="Stop name"
        />
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="w-3 h-3 shrink-0" />
          <input
            type="number"
            value={stop.durationMinutes}
            onChange={(e) => onChangeDuration(stop.id, Number(e.target.value))}
            className="w-10 bg-transparent outline-none border-b border-dashed border-muted-foreground/40 text-center"
            min={1}
          />
          <span>min stop</span>
        </div>
      </div>
      <button
        onClick={() => onRemove(stop.id)}
        className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default function RouteBuilder() {
  const params = useParams();
  const routeId = params.id ? parseInt(params.id) : undefined;
  const [, setLocation] = useLocation();
  const { mapboxToken, openMapboxPrompt } = useAppStore();
  const { toast } = useToast();
  const mapRef = useRef<MapRef>(null);

  const [name, setName] = useState("");
  const [speed, setSpeed] = useState(60);
  const [start, setStart] = useState<RoutePoint | null>(null);
  const [end, setEnd] = useState<RoutePoint | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [showAddStop, setShowAddStop] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [mapClick, setMapClick] = useState<MapClickState | null>(null);

  // Route alternatives
  const [routeOptions, setRouteOptions] = useState<RouteOption[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);

  // The currently chosen route data
  const selectedRoute = routeOptions[selectedIdx] ?? null;
  const polyline = selectedRoute?.polyline ?? [];
  const distance = selectedRoute?.distanceM ?? 0;
  const duration = selectedRoute?.durationS ?? 0;
  const speedProfile: SpeedSegment[] = selectedRoute?.speedProfile ?? [];

  const { data: existingRoute } = useGetRoute(routeId || 0, {
    query: { queryKey: getGetRouteQueryKey(routeId || 0), enabled: !!routeId },
  });
  const createMut = useCreateRoute();
  const updateMut = useUpdateRoute();
  const paymentMut = useCreatePayment();

  useEffect(() => {
    if (!existingRoute) return;
    setName(existingRoute.name);
    setSpeed(existingRoute.truckSpeedKmh);
    setStart({ lng: existingRoute.startLng, lat: existingRoute.startLat, label: `${existingRoute.startLat.toFixed(4)}, ${existingRoute.startLng.toFixed(4)}` });
    setEnd({ lng: existingRoute.endLng, lat: existingRoute.endLat, label: `${existingRoute.endLat.toFixed(4)}, ${existingRoute.endLng.toFixed(4)}` });
    setStops(existingRoute.stops.map(s => ({
      id: `db-${s.id}`, name: s.name, lat: s.lat, lng: s.lng,
      durationMinutes: s.durationMinutes, dbId: s.id,
    })));
    // Restore the saved route as a single option
    if (existingRoute.polyline?.length) {
      setRouteOptions([{
        polyline: existingRoute.polyline,
        distanceM: existingRoute.distanceM || 0,
        durationS: existingRoute.estimatedDurationS || 0,
        speedProfile: existingRoute.speedProfile ?? [],
      }]);
      setSelectedIdx(0);
    }
  }, [existingRoute]);

  // Fetch route alternatives whenever start/end/stops change
  useEffect(() => {
    if (!start || !end) {
      setRouteOptions([]);
      return;
    }
    const t = setTimeout(async () => {
      setIsRouting(true);
      const coords = [[start.lng, start.lat], ...stops.map(s => [s.lng, s.lat]), [end.lng, end.lat]];

      try {
        let options: RouteOption[] = [];

        if (mapboxToken) {
          // Mapbox returns up to 3 alternatives; enrich with OSRM speed profiles
          const [mbOptions, osrmOptions] = await Promise.all([
            fetchDirections(coords, mapboxToken),
            fetchOsrmDirections(coords),
          ]);
          if (mbOptions && mbOptions.length > 0) {
            // Assign OSRM speed profiles by index (best-effort match)
            options = mbOptions.map((opt, i) => ({
              ...opt,
              speedProfile: osrmOptions?.[i]?.speedProfile ?? osrmOptions?.[0]?.speedProfile ?? [],
            }));
          } else if (osrmOptions) {
            options = osrmOptions;
          }
        } else {
          // No Mapbox token: use OSRM only
          const osrmOptions = await fetchOsrmDirections(coords);
          if (osrmOptions) options = osrmOptions;
        }

        if (options.length > 0) {
          setRouteOptions(options);
          setSelectedIdx(0);

          // Fit map to the first (shortest) route
          if (mapRef.current && mapboxToken) {
            const bounds = new mapboxgl.LngLatBounds([start.lng, start.lat], [start.lng, start.lat]);
            options[0].polyline.forEach(c => bounds.extend(c as [number, number]));
            mapRef.current.fitBounds(bounds, { padding: 80, duration: 800 });
          }
        } else {
          setRouteOptions([]);
          toast({
            title: "No road route found",
            description: "These two locations cannot be connected by road. Check that both points are on the same landmass and reachable by vehicle.",
            variant: "destructive",
          });
        }
      } finally {
        setIsRouting(false);
      }
    }, 400);
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

  const handleAddStop = (result: { placeName: string; lng: number; lat: number }) => {
    const label = result.placeName.split(',')[0].trim();
    setStops(prev => [...prev, {
      id: `client-${Date.now()}`, name: label,
      lat: result.lat, lng: result.lng, durationMinutes: 15,
    }]);
    setShowAddStop(false);
  };

  const handleMapClick = useCallback(async (e: mapboxgl.MapMouseEvent) => {
    const { lng, lat } = e.lngLat;
    setMapClick({ lng, lat, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, loading: true });
    const label = await reverseGeocode(lat, lng, mapboxToken);
    setMapClick({ lng, lat, label, loading: false });
  }, [mapboxToken]);

  const applyMapClick = (type: 'start' | 'end' | 'stop') => {
    if (!mapClick) return;
    const shortLabel = mapClick.label.split(',')[0].trim();
    if (type === 'start') {
      setStart({ lng: mapClick.lng, lat: mapClick.lat, label: mapClick.label });
    } else if (type === 'end') {
      setEnd({ lng: mapClick.lng, lat: mapClick.lat, label: mapClick.label });
    } else {
      setStops(prev => [...prev, {
        id: `client-${Date.now()}`, name: shortLabel,
        lat: mapClick.lat, lng: mapClick.lng, durationMinutes: 15,
      }]);
    }
    setMapClick(null);
  };

  const handleSave = async (isActivate: boolean) => {
    if (!name.trim()) {
      toast({ title: "Route name required", description: "Please enter a name for this route.", variant: "destructive" });
      return;
    }
    if (!start || !end) {
      toast({ title: "Locations required", description: "Search for and select both a start and end location.", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: name.trim(),
        startLat: start.lat, startLng: start.lng,
        endLat: end.lat, endLng: end.lng,
        truckSpeedKmh: speed,
        polyline,
        speedProfile,
      };

      let savedRoute;
      if (routeId) {
        savedRoute = await updateMut.mutateAsync({ id: routeId, data: payload });
      } else {
        savedRoute = await createMut.mutateAsync({ data: payload });
        for (let i = 0; i < stops.length; i++) {
          await fetch(`/api/routes/${savedRoute.id}/stops`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('tracktruck_token')}`,
            },
            body: JSON.stringify({
              name: stops[i].name, lat: stops[i].lat, lng: stops[i].lng,
              durationMinutes: stops[i].durationMinutes, sortOrder: i,
            }),
          });
        }
      }

      if (isActivate) {
        await paymentMut.mutateAsync({ data: { routeId: savedRoute.id, amount: 5000 } });
        toast({ title: "Route Activated!", description: "Your route is ready. Press Play on the dashboard to start tracking." });
      } else {
        toast({ title: "Draft Saved", description: `"${savedRoute.name}" saved successfully.` });
      }
      setLocation('/admin');
    } catch (err: any) {
      const msg = err?.data?.message || err?.message || "Failed to save route";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const fmt = {
    dist: (m: number) => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`,
    dur: (s: number) => {
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      return h > 0 ? `${h}h ${m}m` : `${m} min`;
    },
  };

  // Build GeoJSON sources for all route options
  const routeGeoJsons = routeOptions.map(opt => ({
    type: 'Feature' as const, properties: {},
    geometry: { type: 'LineString' as const, coordinates: opt.polyline },
  }));

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <MapboxPrompt />

      {/* Header */}
      <header className="shrink-0 bg-card border-b border-border/60 px-6 py-3.5 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="p-2 -ml-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-base font-bold font-display leading-tight">{routeId ? "Edit Route" : "Create New Route"}</h1>
            <p className="text-xs text-muted-foreground">Search locations or click the map · compare route options · save your choice</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openMapboxPrompt}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            title="Configure Mapbox Token"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleSave(false)}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50"
          >
            <Save className="w-4 h-4" /> Save Draft
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={isSaving}
            className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-primary to-blue-500 text-white rounded-xl font-bold text-sm shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50"
          >
            <CreditCard className="w-4 h-4" /> Activate Route
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left Panel */}
        <aside className="w-96 shrink-0 bg-background border-r border-border/60 flex flex-col overflow-y-auto">
          <div className="p-5 space-y-5">

            {/* Name & Speed */}
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5 block">Route Name *</label>
                <input
                  type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. City Center to Airport"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card border border-border focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5 flex justify-between items-center">
                  <span>Truck Speed</span>
                  <span className="text-primary normal-case font-semibold">{speed} km/h</span>
                </label>
                <input
                  type="range" min={30} max={120} step={5}
                  value={speed} onChange={(e) => setSpeed(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
            </div>

            <hr className="border-border/50" />

            {/* Route Points */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Route Points *</h3>
                {mapboxToken && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Click map to place
                  </span>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 flex items-center gap-2">
                  <div className="w-3.5 h-3.5 rounded-full bg-black border border-white ring-2 ring-black/20 shrink-0" />
                  Start Location
                </label>
                <AddressSearch
                  placeholder="Search city, address, or place..."
                  mapboxToken={mapboxToken}
                  value={start?.label}
                  onSelect={(r) => setStart({ lng: r.lng, lat: r.lat, label: r.placeName })}
                />
                {start && (
                  <p className="text-xs text-emerald-600 mt-1 pl-1 font-medium">
                    ✓ {start.lat.toFixed(4)}, {start.lng.toFixed(4)}
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 flex items-center gap-2">
                  <div className="w-3.5 h-3.5 rounded-full bg-primary shrink-0 flex items-center justify-center">
                    <Flag className="w-2 h-2 text-white" />
                  </div>
                  End Location (Destination)
                </label>
                <AddressSearch
                  placeholder="Search destination city or address..."
                  mapboxToken={mapboxToken}
                  value={end?.label}
                  onSelect={(r) => setEnd({ lng: r.lng, lat: r.lat, label: r.placeName })}
                />
                {end && (
                  <p className="text-xs text-emerald-600 mt-1 pl-1 font-medium">
                    ✓ {end.lat.toFixed(4)}, {end.lng.toFixed(4)}
                  </p>
                )}
              </div>
            </div>

            <hr className="border-border/50" />

            {/* Route Alternatives */}
            {(isRouting || routeOptions.length > 0) && (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Route Options</h3>
                    {isRouting && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                  </div>

                  {isRouting && routeOptions.length === 0 ? (
                    <div className="flex items-center gap-2 py-3 px-3 rounded-xl bg-muted/40">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
                      <p className="text-xs text-muted-foreground">Calculating routes…</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {routeOptions.map((opt, i) => {
                        const label = routeLabel(i, opt, routeOptions);
                        const isSelected = i === selectedIdx;
                        return (
                          <button
                            key={i}
                            onClick={() => setSelectedIdx(i)}
                            className={`w-full text-left rounded-xl border p-3 transition-all ${
                              isSelected
                                ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20'
                                : 'border-border/60 bg-muted/20 hover:bg-muted/40 hover:border-border'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full shrink-0 ${isSelected ? 'bg-primary' : 'bg-slate-300'}`} />
                                <span className={`text-xs font-bold ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}>
                                  {label}
                                </span>
                              </div>
                              {isSelected && (
                                <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                              )}
                            </div>
                            <div className="flex items-center gap-3 pl-5">
                              <span className="text-sm font-bold text-foreground">{fmt.dist(opt.distanceM)}</span>
                              <span className="text-xs text-muted-foreground">·</span>
                              <span className="text-xs text-muted-foreground">{fmt.dur(opt.durationS)}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <hr className="border-border/50" />
              </>
            )}

            {/* Stops */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Waypoint Stops ({stops.length})
                </h3>
                <button
                  onClick={() => setShowAddStop(!showAddStop)}
                  className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Stop
                </button>
              </div>

              {showAddStop && (
                <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-medium text-foreground">Search for a waypoint stop:</p>
                  <AddressSearch
                    placeholder="e.g. Port, Warehouse, Checkpoint..."
                    mapboxToken={mapboxToken}
                    onSelect={handleAddStop}
                  />
                  <button onClick={() => setShowAddStop(false)} className="text-xs text-muted-foreground hover:text-foreground">
                    Cancel
                  </button>
                </div>
              )}

              {stops.length > 0 ? (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={stops.map(s => s.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                      {stops.map((stop, i) => (
                        <SortableStopItem
                          key={stop.id}
                          stop={stop}
                          index={i}
                          onRemove={(id) => setStops(s => s.filter(x => x.id !== id))}
                          onChangeName={(id, val) => setStops(s => s.map(x => x.id === id ? { ...x, name: val } : x))}
                          onChangeDuration={(id, val) => setStops(s => s.map(x => x.id === id ? { ...x, durationMinutes: val } : x))}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              ) : !showAddStop ? (
                <p className="text-xs text-muted-foreground py-2">
                  Optional — add stops for checkpoints, loading bays, or deliveries along the route.
                </p>
              ) : null}
            </div>

            {/* Summary */}
            {distance > 0 && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-700 mb-3">Selected Route</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-emerald-600/70 mb-0.5">Distance</p>
                    <p className="text-lg font-bold text-emerald-800">{fmt.dist(distance)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-emerald-600/70 mb-0.5">Est. Drive Time</p>
                    <p className="text-lg font-bold text-emerald-800">{fmt.dur(duration)}</p>
                  </div>
                </div>
                <p className="text-xs text-emerald-600/70 mt-2">Real road geometry · {routeOptions.length} option{routeOptions.length !== 1 ? 's' : ''} found</p>
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
              initialViewState={{
                longitude: start?.lng ?? 20,
                latitude: start?.lat ?? 40,
                zoom: start ? 7 : 2,
              }}
              mapStyle="mapbox://styles/mapbox/light-v11"
              cursor="crosshair"
              onClick={handleMapClick}
            >
              {/* Unselected route alternatives (grey, behind) */}
              {routeGeoJsons.map((geo, i) => {
                if (i === selectedIdx) return null;
                return (
                  <Source key={`alt-${i}`} id={`alt-route-${i}`} type="geojson" data={geo}>
                    <Layer
                      id={`alt-line-${i}`}
                      type="line"
                      paint={{ 'line-color': '#cbd5e1', 'line-width': 4, 'line-opacity': 0.7 }}
                    />
                  </Source>
                );
              })}

              {/* Selected route (colored, on top) */}
              {polyline.length >= 2 && (
                <Source id="selected-route" type="geojson" data={routeGeoJsons[selectedIdx]}>
                  <Layer
                    id="selected-line"
                    type="line"
                    paint={{ 'line-color': 'hsl(239 84% 67%)', 'line-width': 5, 'line-opacity': 0.9 }}
                  />
                </Source>
              )}

              {/* Start marker */}
              {start && (
                <Marker longitude={start.lng} latitude={start.lat} anchor="center">
                  <div className="w-5 h-5 bg-black rounded-full border-2 border-white shadow-lg" />
                </Marker>
              )}

              {/* End marker */}
              {end && (
                <Marker longitude={end.lng} latitude={end.lat} anchor="center">
                  <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white shadow-xl border-2 border-white">
                    <Navigation className="w-4 h-4 fill-current" />
                  </div>
                </Marker>
              )}

              {/* Stop markers */}
              {stops.map((stop, i) => (
                <Marker key={stop.id} longitude={stop.lng} latitude={stop.lat} anchor="center">
                  <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center text-primary shadow-lg border-2 border-primary font-bold text-xs">
                    {i + 1}
                  </div>
                </Marker>
              ))}

              {/* Map-click popup */}
              {mapClick && (
                <Popup
                  longitude={mapClick.lng}
                  latitude={mapClick.lat}
                  anchor="bottom"
                  closeButton={false}
                  closeOnClick={false}
                  className="map-click-popup"
                  maxWidth="260px"
                >
                  <div className="bg-white rounded-xl shadow-xl border border-border overflow-hidden" style={{ minWidth: 220 }}>
                    <div className="flex items-start justify-between gap-2 px-3 pt-3 pb-2 border-b border-border/50">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-foreground mb-0.5">Place on map</p>
                        {mapClick.loading ? (
                          <p className="text-xs text-muted-foreground animate-pulse">Looking up address…</p>
                        ) : (
                          <p className="text-xs text-muted-foreground leading-snug line-clamp-2">{mapClick.label}</p>
                        )}
                      </div>
                      <button
                        onClick={() => setMapClick(null)}
                        className="p-0.5 text-muted-foreground hover:text-foreground rounded shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="p-2 space-y-1">
                      <button
                        onClick={() => applyMapClick('start')}
                        disabled={mapClick.loading}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50 text-left"
                      >
                        <div className="w-3 h-3 rounded-full bg-black shrink-0" />
                        Set as Start
                      </button>
                      <button
                        onClick={() => applyMapClick('end')}
                        disabled={mapClick.loading}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50 text-left"
                      >
                        <div className="w-3 h-3 rounded-full bg-primary shrink-0" />
                        Set as End
                      </button>
                      <button
                        onClick={() => applyMapClick('stop')}
                        disabled={mapClick.loading}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50 text-left"
                      >
                        <div className="w-3 h-3 rounded-full bg-white border-2 border-primary shrink-0" />
                        Add as Waypoint Stop
                      </button>
                    </div>
                  </div>
                </Popup>
              )}

              {/* Loading overlay */}
              {isRouting && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none z-10">
                  <div className="bg-black/70 text-white text-xs font-medium px-4 py-2 rounded-full flex items-center gap-2 shadow-lg backdrop-blur-sm">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Finding best routes…
                  </div>
                </div>
              )}

              {/* Map hint */}
              {!start && !end && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-none">
                  <div className="bg-black/70 text-white text-xs font-medium px-4 py-2 rounded-full flex items-center gap-2 shadow-lg backdrop-blur-sm">
                    <MapPin className="w-3.5 h-3.5" />
                    Click anywhere on the map to place start or end points
                  </div>
                </div>
              )}
            </Map>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-5 p-8">
              <div className="w-20 h-20 bg-muted rounded-3xl flex items-center justify-center">
                <MapIcon className="w-10 h-10 text-muted-foreground" />
              </div>
              <div className="text-center max-w-sm">
                <p className="font-bold text-foreground text-lg mb-2">Map preview disabled</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Configure a Mapbox token to see route options on a map, click to place points, and get turn-by-turn directions.
                  Address search and route calculation work without a token.
                </p>
                <button
                  onClick={openMapboxPrompt}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-semibold text-sm hover:bg-primary/90 transition-colors shadow-md"
                >
                  <Settings className="w-4 h-4" /> Configure Mapbox Token
                </button>
              </div>
              {start && end && (
                <div className="bg-white rounded-2xl border border-border p-4 text-sm max-w-xs w-full">
                  <div className="flex items-start gap-2 mb-2">
                    <div className="w-3 h-3 rounded-full bg-black mt-0.5 shrink-0" />
                    <span className="text-foreground line-clamp-2">{start.label}</span>
                  </div>
                  {stops.map((s) => (
                    <div key={s.id} className="flex items-start gap-2 mb-2 pl-1">
                      <div className="w-2 h-2 rounded-full bg-primary/50 mt-1 shrink-0" />
                      <span className="text-muted-foreground text-xs">{s.name}</span>
                    </div>
                  ))}
                  <div className="flex items-start gap-2">
                    <div className="w-3 h-3 rounded-full bg-primary mt-0.5 shrink-0" />
                    <span className="text-foreground line-clamp-2">{end.label}</span>
                  </div>
                  {distance > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground">
                      Distance: {fmt.dist(distance)} · Est. {fmt.dur(duration)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
