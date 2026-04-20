import { useState, useEffect, useRef, useCallback, memo } from "react";
import { Link, useLocation, useParams } from "wouter";
import Map, { Marker, Source, Layer, MapRef, Popup } from "react-map-gl";
import mapboxgl from "mapbox-gl";
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  ArrowLeft, Save, Zap, Flag, GripVertical,
  Plus, Trash2, MapPin, X, Loader2, Play, Pause,
  Pencil, AlertTriangle, Gauge, Settings, Copy, CheckCircle2, Clock, Check, MapIcon
} from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { MapboxPrompt } from "@/components/MapboxPrompt";
import { AddressSearch } from "@/components/AddressSearch";
import { useAppStore } from "@/store/use-app-store";
import { useToast } from "@/hooks/use-toast";
import { fetchDirections, fetchOsrmDirections, type RouteOption, type SpeedSegment } from "@/lib/mapbox-utils";
import { useCreateRoute, useUpdateRoute, useGetRoute, useActivateRoute, useStartRoute, usePauseRoute, useResumeRoute } from "@workspace/api-client-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";

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

// Extracted component: manages its own 60fps rAF animation loop so only
// this small tree re-renders on every frame, not the entire RouteBuilder.
// Move outside main component and memoize to protect from parent re-renders
const AnimatedTruckMarker = memo(({ snapshot }: {
  snapshot: { lat: number; lng: number; bearing: number } | null;
}) => {
  const TICK_MS = 2000;
  const [pos, setPos] = useState<{ lat: number; lng: number; bearing: number } | null>(null);
  const posRef = useRef<{ lat: number; lng: number; bearing: number } | null>(null);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    if (snapshot?.lat == null || snapshot?.lng == null) {
      setPos(null);
      posRef.current = null;
      return;
    }
    const target = { lat: snapshot.lat, lng: snapshot.lng, bearing: snapshot.bearing };

    // If it's the first snapshot, jump to it immediately
    if (!posRef.current) {
      setPos(target);
      posRef.current = target;
      return;
    }

    const from = posRef.current;
    const startTime = performance.now();
    if (animRef.current != null) cancelAnimationFrame(animRef.current);

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / TICK_MS, 1);

      let bdiff = target.bearing - from.bearing;
      if (bdiff > 180) bdiff -= 360;
      if (bdiff < -180) bdiff += 360;

      const p = {
        lat: from.lat + (target.lat - from.lat) * t,
        lng: from.lng + (target.lng - from.lng) * t,
        bearing: from.bearing + bdiff * t,
      };

      posRef.current = p;
      setPos(p);

      if (t < 1) {
        animRef.current = requestAnimationFrame(animate);
      }
    };

    animRef.current = requestAnimationFrame(animate);
    return () => { if (animRef.current != null) cancelAnimationFrame(animRef.current); };
  }, [snapshot]);

  if (!pos) return null;
  return (
    <Marker longitude={pos.lng} latitude={pos.lat} anchor="center">
      <div className="relative flex items-center justify-center">
        <div className="absolute w-12 h-12 rounded-full bg-primary/25 animate-ping" />
        <div
          className="relative z-10 drop-shadow-xl"
          style={{ transform: `rotate(${pos.bearing}deg)` }}
        >
          <svg width="40" height="40" viewBox="0 0 44 44" fill="none">
            <circle cx="22" cy="22" r="20" fill="#3b3ef4" stroke="white" strokeWidth="2.5" />
            <path d="M22 9 L29 30 L22 25.5 L15 30 Z" fill="white" />
          </svg>
        </div>
      </div>
    </Marker>
  );
});

AnimatedTruckMarker.displayName = 'AnimatedTruckMarker';

function SortableStopItem({ stop, index, onRemove, onChangeName, onChangeDuration, atStopName, countdownSec }: {
  stop: Stop; index: number;
  onRemove: (id: string) => void;
  onChangeName: (id: string, val: string) => void;
  onChangeDuration: (id: string, val: number) => void;
  atStopName: string | null;
  countdownSec: number | null;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: stop.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className={`flex flex-col gap-2 bg-muted/40 border border-border/60 rounded-xl p-3 group transition-all ${atStopName === stop.name ? 'ring-2 ring-amber-500 bg-amber-50/50 border-amber-200 shadow-sm' : ''}`}>
      <div className="flex gap-2 items-center">
        <div {...attributes} {...listeners} className="cursor-grab p-1 text-muted-foreground hover:text-foreground shrink-0">
          <GripVertical className="w-4 h-4" />
        </div>
        <div className={`w-6 h-6 rounded-full bg-white border-2 flex items-center justify-center font-bold text-xs shrink-0 ${atStopName === stop.name ? 'border-amber-500 text-amber-500 animate-pulse' : 'border-primary text-primary'}`}>
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

      {atStopName === stop.name && countdownSec !== null && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 bg-amber-500/10 rounded-lg border border-amber-500/30 animate-in slide-in-from-top-1">
          <Clock className="w-3 h-3 text-amber-600 animate-spin-slow" />
          <span className="text-xs font-bold text-amber-800 tabular-nums">
            Departing in {Math.floor(countdownSec / 60)}:{String(countdownSec % 60).padStart(2, '0')}
          </span>
        </div>
      )}
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
  const [start, setStart] = useState<RoutePoint | null>(null);
  const [end, setEnd] = useState<RoutePoint | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [showAddStop, setShowAddStop] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [speedSaving, setSpeedSaving] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [mapClick, setMapClick] = useState<MapClickState | null>(null);

  // Live truck position for in-progress routes
  const [liveSnapshot, setLiveSnapshot] = useState<{ lat: number; lng: number; bearing: number; speedMph: number; atStopName: string | null } | null>(null);

  // Stop countdown: track when truck arrived at current stop
  const [stopArrivalTime, setStopArrivalTime] = useState<number | null>(null);
  const [countdownSec, setCountdownSec] = useState<number | null>(null);
  const prevStopNameRef = useRef<string | null>(null);

  const atStopName = liveSnapshot?.atStopName ?? null;

  // Track stop arrivals and start countdown
  useEffect(() => {
    const currentStop = atStopName;
    if (currentStop && currentStop !== prevStopNameRef.current) {
      setStopArrivalTime(Date.now());
    } else if (!currentStop) {
      setStopArrivalTime(null);
      setCountdownSec(null);
    }
    prevStopNameRef.current = currentStop;
  }, [atStopName]);

  // Countdown ticker
  useEffect(() => {
    if (!stopArrivalTime || !atStopName) return;
    const stopData = stops.find(s => s.name === atStopName);
    const totalSec = (stopData?.durationMinutes ?? 5) * 60;
    const tick = () => {
      const elapsed = (Date.now() - stopArrivalTime) / 1000;
      const remaining = Math.max(0, Math.round(totalSec - elapsed));
      setCountdownSec(remaining);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [stopArrivalTime, atStopName, stops]);


  // Route-change gate: when live, start/end are locked until admin explicitly unlocks
  const [routeChangeMode, setRouteChangeMode] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Custom simulation duration
  const [useCustomDuration, setUseCustomDuration] = useState(false);
  const [customDurationMinutes, setCustomDurationMinutes] = useState(0);

  // Speed visibility for public tracking page
  const [showSpeedPublic, setShowSpeedPublic] = useState(true);

  // Route alternatives
  const [routeOptions, setRouteOptions] = useState<RouteOption[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [routingError, setRoutingError] = useState<string | null>(null);

  // The currently chosen route data
  const selectedRoute = routeOptions[selectedIdx] ?? null;
  const polyline = selectedRoute?.polyline ?? [];
  const distance = selectedRoute?.distanceM ?? 0;
  const duration = selectedRoute?.durationS ?? 0;
  const speedProfile: SpeedSegment[] = selectedRoute?.speedProfile ?? [];

  const { data: existingRoute, refetch: refetchRoute } = useGetRoute(routeId || -1, {
    query: { enabled: !!routeId } as any,
  });

  const isLiveRoute = ['in_progress', 'paused'].includes(existingRoute?.status ?? '');
  const isCompleted = existingRoute?.status === 'completed';
  const routeLocked = (isLiveRoute && !routeChangeMode) || isCompleted;
  const isActivatedRoute = ['ready', 'in_progress', 'paused', 'completed'].includes(existingRoute?.status ?? '');
  const liveSpeedMph = liveSnapshot?.speedMph ?? null;

  const { user } = useAppStore();
  const isUser = user?.role === 'user';
  const updateCount = (existingRoute as any)?.updateCount ?? 0;
  const remainingChanges = Math.max(0, 1 - updateCount);
  const modificationsRestricted = isUser && isLiveRoute && remainingChanges === 0;
  const isQuotaReached = isUser && (user as any).usedRoutes >= (user as any).routeLimit;

  const [copied, setCopied] = useState(false);
  const copyShareUrl = () => {
    const token = existingRoute?.shareToken;
    if (!token) return;
    const url = `${window.location.origin}/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast({ title: 'Link copied!', description: url });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const createMut = useCreateRoute();
  const updateMut = useUpdateRoute();
  const activateMut = useActivateRoute();

  const startMut = useStartRoute();
  const pauseMut = usePauseRoute();
  const resumeMut = useResumeRoute();
  const [simActionLoading, setSimActionLoading] = useState<string | null>(null);


  const handleSimAction = async (action: 'start' | 'pause' | 'resume') => {
    if (!routeId) return;
    setSimActionLoading(action);
    try {
      if (action === 'start') {
        // If we have local unsaved changes (status is ready), save them first
        // We check if status is 'ready' to ensure we capture the final geometry
        const status = existingRoute?.status;
        if (status === 'ready') {
          const payload = {
            name: name.trim(),
            startLat: start?.lat, startLng: start?.lng,
            endLat: end?.lat, endLng: end?.lng,
            truckSpeedMph: 60,
            polyline,
            speedProfile,
          };
          await updateMut.mutateAsync({ id: routeId, data: payload });
        }
        await startMut.mutateAsync({ id: routeId });
      } else if (action === 'pause') {
        await pauseMut.mutateAsync({ id: routeId });
      } else if (action === 'resume') {
        await resumeMut.mutateAsync({ id: routeId });
      }
      await refetchRoute();
    } catch (err: any) {
      const errorData = err.response?.data;
      toast({ title: "Error", description: `Failed to ${action} simulation. ${errorData?.message || ""}`, variant: "destructive" });
    } finally {
      setSimActionLoading(null);
    }
  };

  const initializedRouteIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!existingRoute) return;
    // Only initialize form fields ONCE per route — subsequent refetches
    // (from WS, speed saves, etc.) should NOT re-set the form and cause blinking
    if (initializedRouteIdRef.current === existingRoute.id) return;
    initializedRouteIdRef.current = existingRoute.id;

    setName(existingRoute.name.startsWith("UNFINISHED ROUTE") ? "" : existingRoute.name);
    setStart({ lng: existingRoute.startLng, lat: existingRoute.startLat, label: `${existingRoute.startLat.toFixed(4)}, ${existingRoute.startLng.toFixed(4)}` });
    setEnd({ lng: existingRoute.endLng, lat: existingRoute.endLat, label: `${existingRoute.endLat.toFixed(4)}, ${existingRoute.endLng.toFixed(4)}` });
    setStops(existingRoute.stops.map(s => ({
      id: s.id.toString(),
      dbId: s.id,
      name: s.name,
      lng: s.lng,
      lat: s.lat,
      durationMinutes: s.durationMinutes,
      sortOrder: s.sortOrder,
    })));

    // Initialize truck marker from initial snapshot (e.g. for completed routes)
    if (existingRoute.snapshot && !liveSnapshot) {
      setLiveSnapshot(existingRoute.snapshot as any);
    }
  }, [existingRoute, liveSnapshot]);

  // Restore the saved route as a single option
  useEffect(() => {
    if (!existingRoute) return;
    if (existingRoute.polyline?.length) {
      setRouteOptions([{
        polyline: existingRoute.polyline,
        distanceM: existingRoute.distanceM || 0,
        durationS: existingRoute.estimatedDurationS || 0,
        speedProfile: existingRoute.speedProfile ?? [],
      }]);
      setSelectedIdx(0);
    }

    // Custom duration: always start unchecked — user opens it manually when needed
    // But always populate the saved value so it's there when they check the box
    if (existingRoute.customDurationS) {
      setCustomDurationMinutes(Math.round(existingRoute.customDurationS / 60));
    }
    const er = existingRoute as any;
    setShowSpeedPublic(er.showSpeedPublic ?? true);
  }, [existingRoute]);

  // --- Resolve Start/End addresses if they are initially coordinates ---
  useEffect(() => {
    if (!mapboxToken) return;
    const resolve = async (point: { lat: number, lng: number, label: string }, setter: any) => {
      // If label looks like '-12.3456, 78.9012'
      const isCoord = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(point.label);
      if (!isCoord) return;
      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${point.lng},${point.lat}.json?access_token=${mapboxToken}&types=address,place,poi&limit=1`;
        const res = await fetch(url);
        const data = await res.json();
        const address = data.features?.[0]?.place_name;
        if (address) {
          setter((prev: any) => prev && prev.lat === point.lat && prev.lng === point.lng ? { ...prev, label: address } : prev);
        }
      } catch (e) { console.error("Geocoding error", e); }
    };
    if (start) resolve(start, setStart);
    if (end) resolve(end, setEnd);
  }, [start?.lat, start?.lng, end?.lat, end?.lng, mapboxToken]);

  // --- Admin live WebSocket: show truck position when route is in_progress ---
  // When paused, keep the last known snapshot so the marker stays visible.
  useEffect(() => {
    const status = existingRoute?.status ?? '';

    // Only clear snapshot for non-live statuses
    if (!['in_progress', 'paused'].includes(status)) {
      setLiveSnapshot(null);
    }

    if (!routeId) return;

    // For live routes (progress/paused) that were just loaded: fetch last known position immediately
    // so the truck appears without waiting up to 2s for the next WS tick.
    if (['in_progress', 'paused'].includes(status) && existingRoute?.shareToken) {
      fetch(`/api/public/track/${existingRoute.shareToken}`)
        .then(r => r.json())
        .then(data => {
          if (data?.snapshot?.lat != null) {
            setLiveSnapshot({
              lat: data.snapshot.lat,
              lng: data.snapshot.lng,
              bearing: data.snapshot.bearing ?? 0,
              speedMph: data.snapshot.speedMph ?? 0,
              atStopName: data.snapshot.atStopName || null,
            });
          }
        })
        .catch(() => { });
    }

    // Only connect WS when actively running or paused (stay connected for immediate resume)
    if (!['in_progress', 'paused'].includes(status)) {
      return;
    }

    const jwt = localStorage.getItem('tracktruck_token');
    if (!jwt) return;

    const apiUrl = import.meta.env.VITE_API_URL;
    const wsHost = apiUrl ? new URL(apiUrl).host : window.location.host;
    const wsProtocol = (apiUrl ? new URL(apiUrl).protocol : window.location.protocol) === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${wsHost}/api/admin/ws/routes/${routeId}?token=${encodeURIComponent(jwt)}`;

    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.lat !== undefined && data.lng !== undefined) {
            setLiveSnapshot(prev => ({
              ...prev,
              lat: data.lat,
              lng: data.lng,
              bearing: data.bearing ?? 0,
              speedMph: data.speedMph ?? 0,
              atStopName: data.atStopName || null,
            }));
          } else if (data.type === "route_updated") {
            initializedRouteIdRef.current = null;
            refetchRoute();
          }
        } catch { }
      };
      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 4000);
      };
    };

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null; // prevent reconnection during unmount
        ws.close();
      }
    };
  }, [routeId, existingRoute?.status, existingRoute?.shareToken]);

  // --- Auto-save to DB (debounced) ---
  useEffect(() => {
    // Check if anything has actually changed from the last known state
    // For existing routes, we compare with existingRoute.
    // For new routes, we check if start/end/stops or name is populated.
    let isDirty = false;
    if (routeId && existingRoute) {
      if (!['draft', 'ready'].includes(existingRoute.status)) return;
      isDirty = 
        name !== existingRoute.name || 
        start?.lat !== existingRoute.startLat || 
        start?.lng !== existingRoute.startLng ||
        end?.lat !== existingRoute.endLat ||
        end?.lng !== existingRoute.endLng ||
        stops.length !== existingRoute.stops.length;
    } else if (!routeId) {
      // For a brand new route, we are dirty if the user set a location or a name
      isDirty = (!!name && name.trim().length > 0) || !!start || !!end || stops.length > 0;
    }

    if (!isDirty) return;

    const timer = setTimeout(async () => {
      try {
        const placeholderName = `UNFINISHED ROUTE`;
        const payload = {
          name: name.trim() || placeholderName,
          startLat: start?.lat ?? 0,
          startLng: start?.lng ?? 0,
          endLat: end?.lat ?? 0,
          endLng: end?.lng ?? 0,
          truckSpeedMph: 60,
          polyline,
          speedProfile,
        };

        if (routeId) {
          await updateMut.mutateAsync({ id: routeId, data: payload });
        } else {
          // IMPORTANT: Create the route in the DB and redirect to its new edit URL
          const resp = await createMut.mutateAsync({ data: payload });
          // Use replace: true so the "Back" button goes to Dashboard, not the empty /new page
          setLocation(`/admin/routes/${resp.id}/edit`, { replace: true });
        }
      } catch (err) {
        console.error("Auto-save failed", err);
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [name, start, end, stops, polyline, speedProfile, routeId, existingRoute, updateMut, createMut, setLocation]);

  // Use a generation counter to discard stale async routing responses
  const routingGen = useRef(0);

  // Fetch route alternatives whenever start/end changes — stops do NOT affect the route calculation
  useEffect(() => {
    if (!start || !end) {
      setRouteOptions([]);
      setRoutingError(null);
      return;
    }
    const gen = ++routingGen.current;
    const t = setTimeout(async () => {
      setIsRouting(true);
      setRoutingError(null);
      const coords = [[start.lng, start.lat], [end.lng, end.lat]];

      try {
        let options: RouteOption[] = [];

        if (mapboxToken) {
          // Priority 1: Mapbox (fastest and most accurate for driving)
          const mbOptions = await fetchDirections(coords, mapboxToken);

          if (mbOptions && mbOptions.length > 0) {
            options = mbOptions;
          } else {
            // Priority 2: OSRM Fallback (if Mapbox fails or finds no route)
            const osrmOptions = await fetchOsrmDirections(coords);
            if (osrmOptions) options = osrmOptions;
          }
        } else {
          // No Mapbox token: use OSRM only
          const osrmOptions = await fetchOsrmDirections(coords);
          if (osrmOptions) options = osrmOptions;
        }

        // Discard stale response if a newer routing request has started
        if (gen !== routingGen.current) return;

        if (options.length > 0) {
          setRouteOptions(options);
          // Only auto-select the first option for completely new routes.
          // For existing routes, we want to maintain the selection provided by the init effect.
          if (!routeId) setSelectedIdx(0);

          // Fit map to the first (shortest) route
          if (mapRef.current && mapboxToken) {
            const bounds = new mapboxgl.LngLatBounds([start.lng, start.lat], [start.lng, start.lat]);
            options[0].polyline.forEach(c => bounds.extend(c as [number, number]));
            mapRef.current.fitBounds(bounds, { padding: 80, duration: 800 });
          }
        } else {
          setRouteOptions([]);
          const errMsg = "No road route found — these locations cannot be connected by road without crossing water. Check that both points are reachable by vehicle on the same landmass.";
          setRoutingError(errMsg);
          toast({
            title: "No road route found",
            description: errMsg,
            variant: "destructive",
          });
        }
      } finally {
        if (gen === routingGen.current) setIsRouting(false);
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, mapboxToken]);

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

  const handleAddStop = async (result: { placeName: string; lng: number; lat: number }) => {
    const tempId = `client-${Date.now()}`;
    setStops(prev => {
      const newStop: Stop = { id: tempId, name: result.placeName, lat: result.lat, lng: result.lng, durationMinutes: 15 };
      if (isLiveRouteRef.current) {
        const sortOrder = prev.length;
        saveStopToDb(newStop, sortOrder).then(dbId => {
          if (dbId != null) {
            setStops(s => s.map(x => x.id === tempId ? { ...x, id: `db-${dbId}`, dbId } : x));
          }
        });
      }
      return [...prev, newStop];
    });
    setShowAddStop(false);
  };

  const showAddStopRef = useRef(showAddStop);
  showAddStopRef.current = showAddStop;

  const routeLockedRef = useRef(routeLocked);
  routeLockedRef.current = routeLocked;

  const isLiveRouteRef = useRef(isLiveRoute);
  isLiveRouteRef.current = isLiveRoute;

  const routeIdRef = useRef(routeId);
  routeIdRef.current = routeId;

  const stopsRef = useRef(stops);
  stopsRef.current = stops;

  /** Persist a new stop to the DB immediately (used during live rides) */
  const saveStopToDb = useCallback(async (stop: { name: string; lat: number; lng: number; durationMinutes: number }, sortOrder: number): Promise<number | null> => {
    const id = routeIdRef.current;
    if (!id) return null;
    try {
      const res = await fetch(`/api/routes/${id}/stops`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('tracktruck_token')}`,
        },
        body: JSON.stringify({ ...stop, sortOrder }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.id as number;
    } catch {
      return null;
    }
  }, []);

  /** Delete a stop from the DB (used during live rides) */
  const deleteStopFromDb = useCallback(async (dbId: number) => {
    const id = routeIdRef.current;
    if (!id) return;
    try {
      await fetch(`/api/routes/${id}/stops/${dbId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('tracktruck_token')}` },
      });
    } catch { /* silent */ }
  }, []);

  const handleMapClick = useCallback(async (e: mapboxgl.MapMouseEvent) => {
    const { lng, lat } = e.lngLat;
    if (showAddStopRef.current) {
      // Stop mode: always allowed — instantly place a stop marker
      const tempId = `client-${Date.now()}`;
      const placeholder = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

      // Optimistically add to state
      setStops(prev => {
        const newStop: Stop = { id: tempId, name: placeholder, lat, lng, durationMinutes: 15 };
        return [...prev, newStop];
      });

      // Save to DB immediately when live, then reverse-geocode and update the name
      // stopsRef.current already has the new stop appended above (React batches updates,
      // but we read the PRE-append length here so sortOrder = prev.length)
      const sortOrder = stopsRef.current.length; // will be 1 ahead after setStops runs, fine as sortOrder
      const dbIdPromise: Promise<number | null> = isLiveRouteRef.current
        ? saveStopToDb({ name: placeholder, lat, lng, durationMinutes: 15 }, sortOrder)
        : Promise.resolve(null);

      dbIdPromise.then(dbId => {
        if (dbId != null) {
          setStops(s => s.map(x => x.id === tempId ? { ...x, id: `db-${dbId}`, dbId } : x));
        }
      });

      reverseGeocode(lat, lng, mapboxToken).then(async label => {
        // Update name in state (match by tempId or by the db-prefixed id)
        setStops(s => s.map(x => (x.id === tempId || x.lat === lat && x.lng === lng && x.name === placeholder) ? { ...x, name: label } : x));
        // Also update name in DB if we have the dbId
        const dbId = await dbIdPromise;
        if (dbId != null && routeIdRef.current) {
          setStops(s => s.map(x => x.id === `db-${dbId}` ? { ...x, name: label } : x));
          fetch(`/api/routes/${routeIdRef.current}/stops/${dbId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('tracktruck_token')}` },
            body: JSON.stringify({ name: label }),
          }).catch(() => { });
        }
      });
      return;
    }
    // Normal mode: blocked when route is locked (live and not in change-mode)
    if (routeLockedRef.current) return;
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

  const handleSave = async (isActivate: boolean, noRedirect = false) => {
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
        truckSpeedMph: 60,
        polyline,
        speedProfile,
        // customDurationS is sent only on create; for existing routes, use Update Speed button
        ...(!routeId && { customDurationS: useCustomDuration && customDurationMinutes > 0 ? customDurationMinutes * 60 : null }),
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
        await activateMut.mutateAsync({ id: savedRoute.id });
        // Keep alternatives visible even after activation
        // Reset init ref so if we redirect to the same route ID, the effect re-runs
        initializedRouteIdRef.current = null;
        toast({ title: "Route Activated!", description: "Your route is ready. Press Start to begin tracking." });
        localStorage.removeItem('tracktruck_route_draft');
        // Redirect to the route's edit page so the Start button and controls become visible
        setLocation(`/admin/routes/${savedRoute.id}/edit`);
      } else if (noRedirect) {
        toast({ title: "Route Updated", description: "The live route has been changed and the shared map is updating." });
      } else if (isActivatedRoute) {
        // Already activated — save without redirecting
        toast({ title: "Route Saved", description: `"${savedRoute.name}" updated.` });
        // Force the initialization effect to re-run and sync form state with new server data
        initializedRouteIdRef.current = null;
        await refetchRoute();
      } else {
        // True draft — save and go back to dashboard
        toast({ title: "Draft Saved", description: `"${savedRoute.name}" saved successfully.` });
        localStorage.removeItem('tracktruck_route_draft');
        setLocation('/admin');
      }
    } catch (err: any) {
      const errorData = err.response?.data;
      const msg = errorData?.message || err?.message || "Failed to save route";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const fmt = {
    dist: (m: number) => {
      const mi = m / 1609.34;
      return mi >= 1 ? `${mi.toFixed(1)} mi` : `${Math.round(m / 0.3048)} ft`;
    },
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

          {/* Loading state indicator */}
          {routeId && !existingRoute && (
            <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground text-xs font-medium animate-in fade-in">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Fetching controls...
            </div>
          )}

          {/* Live speed badge */}
          {['in_progress', 'paused'].includes(existingRoute?.status ?? '') && liveSpeedMph !== null && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-xl">
              <Gauge className="w-4 h-4 text-emerald-600" />
              <span className="text-sm font-bold text-emerald-800 tabular-nums">{liveSpeedMph}</span>
              <span className="text-xs text-emerald-600">mph</span>
            </div>
          )}

          {/* Modifications tracking badge (only for live or completed routes) */}
          {(isLiveRoute || isCompleted) && (
            <div className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-xl animate-in fade-in slide-in-from-right-4 ${modificationsRestricted ? 'bg-red-50 border-red-100 text-red-600' : (isCompleted ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-blue-50 border-blue-100 text-blue-600')}`}>
              <AlertTriangle className="w-3.5 h-3.5" />
              <div className="flex flex-col -space-y-0.5">
                <span className="text-[10px] font-bold uppercase tracking-tight">{isUser ? 'Client Quota' : 'Admin Maintenance'}</span>
                <span className="text-[11px] font-medium leading-none">
                  {isUser ? (modificationsRestricted ? 'Modifications Locked' : (isCompleted ? 'Route Locked' : `${remainingChanges} change remaining`)) : 'Unlimited edits'}
                </span>
              </div>
            </div>
          )}

          {/* Copy share URL */}
          {routeId && existingRoute?.shareToken && (
            <button
              onClick={copyShareUrl}
              className="flex items-center gap-2 px-3 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-xl font-semibold text-sm transition-colors"
              title="Copy public tracking link"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied!' : 'Share URL'}
            </button>
          )}

          {/* Simulation controls */}
          {routeId && (existingRoute?.status === 'ready') && (
            <button
              onClick={() => handleSimAction('start')}
              disabled={!!simActionLoading}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white hover:bg-emerald-600 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50 shadow-sm"
            >
              {simActionLoading === 'start' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
              Start
            </button>
          )}
          {routeId && existingRoute?.status === 'in_progress' && (
            <button
              onClick={() => handleSimAction('pause')}
              disabled={!!simActionLoading}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white hover:bg-amber-600 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50 shadow-sm"
            >
              {simActionLoading === 'pause' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4 fill-current" />}
              Pause
            </button>
          )}
          {routeId && existingRoute?.status === 'paused' && (
            <button
              onClick={() => handleSimAction('resume')}
              disabled={!!simActionLoading}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white hover:bg-emerald-600 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50 shadow-sm"
            >
              {simActionLoading === 'resume' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
              Resume
            </button>
          )}

          {routeChangeMode && isLiveRoute ? (
            /* In route-change mode: show Save Route Changes + Cancel */
            <>
              <button
                onClick={() => setRouteChangeMode(false)}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50"
              >
                <X className="w-4 h-4" /> Cancel
              </button>
              <button
                onClick={() => setShowConfirmModal(true)}
                disabled={isSaving}
                className="flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold text-sm shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Route Changes
              </button>
            </>
          ) : routeId && isActivatedRoute && !isLiveRoute && !isCompleted ? (
            /* Activated but not live (ready): Save without redirect */
            <button
              onClick={() => handleSave(false)}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
            </button>
          ) : (routeId && !isActivatedRoute && existingRoute) || !routeId ? (
            /* Existing Draft OR a New Route: Show Save Draft + Activate */
            <>
              <button
                onClick={() => handleSave(false)}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" /> Save Draft
              </button>
              <button
                onClick={() => !isQuotaReached && handleSave(true)}
                disabled={isSaving || isQuotaReached}
                className={`flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-sm shadow-md transition-all disabled:opacity-50 ${isQuotaReached
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed shadow-none'
                    : 'bg-gradient-to-r from-primary to-blue-500 text-white hover:shadow-lg hover:-translate-y-0.5'
                  }`}
                title={isQuotaReached ? "Route limit reached. Deactivate or delete routes to create more." : "Activate and start tracking"}
              >
                <Zap className="w-4 h-4" /> {isQuotaReached ? 'Locked' : 'Activate Route'}
              </button>
            </>
          ) : null}
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left Panel */}
        <aside className="w-96 shrink-0 bg-background border-r border-border/60 flex flex-col overflow-y-auto">
          <div className="p-5 space-y-5">
            {isCompleted && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 flex items-start gap-3 shadow-sm animate-in fade-in slide-in-from-top-2">
                <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center shrink-0 shadow-sm">
                  <CheckCircle2 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-emerald-900 leading-tight">Route Completed</h3>
                  <p className="text-xs text-emerald-700 mt-1 leading-relaxed">
                    This route is finished and locked. Press <strong>Reset</strong> below to clear history and run it again.
                  </p>
                </div>
              </div>
            )}

            {/* Name & Speed */}
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5 block">Route Name *</label>
                <input
                  type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. City Center to Airport"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card border border-border focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all text-sm disabled:opacity-60"
                  disabled={isCompleted}
                />
              </div>

              <div className="space-y-3 p-3.5 rounded-xl border border-border bg-card">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                  Simulation Speed
                </label>

                {/* Show speed on public map toggle — saves immediately */}
                <label className="flex items-center justify-between cursor-pointer py-1">
                  <span className="text-sm font-medium text-foreground">Show speed on public map</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={showSpeedPublic}
                    onClick={async () => {
                      const newVal = !showSpeedPublic;
                      setShowSpeedPublic(newVal);
                      if (!routeId) return;
                      try {
                        await fetch(`/api/routes/${routeId}/speed`, {
                          method: 'PATCH',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${localStorage.getItem('tracktruck_token')}`,
                          },
                          body: JSON.stringify({ showSpeedPublic: newVal }),
                        });
                      } catch {
                        // revert on failure
                        setShowSpeedPublic(!newVal);
                        toast({ title: "Failed", description: "Could not update speed visibility", variant: "destructive" });
                      }
                    }}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${showSpeedPublic ? 'bg-primary' : 'bg-gray-300'}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${showSpeedPublic ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                </label>

                <hr className="border-border/40" />

                {/* Override duration checkbox */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useCustomDuration}
                    onChange={(e) => setUseCustomDuration(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-50"
                  />
                  <span className="text-sm font-semibold text-foreground">
                    Override simulation duration
                  </span>
                </label>

                {useCustomDuration && (
                  <div className="space-y-3 animate-in fade-in slide-in-from-top-1">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        placeholder="60"
                        value={customDurationMinutes || ''}
                        onChange={(e) => setCustomDurationMinutes(parseInt(e.target.value) || 0)}
                        disabled={!useCustomDuration}
                        className="w-24 px-3 py-1.5 rounded-lg border border-border bg-background focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none text-sm transition-all"
                      />
                      <span className="text-sm text-muted-foreground">minutes total</span>
                    </div>
                    <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5">
                      <p className="text-xs font-bold text-amber-900 leading-snug flex gap-1.5 items-start">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500 mt-px" />
                        Warning: This will artificially scale the truck's speed to hit this exact duration.
                      </p>
                    </div>
                  </div>
                )}

                {/* Standalone Update Speed button — only shown for existing routes */}
                {routeId && existingRoute && (
                  <button
                    onClick={async () => {
                      setSpeedSaving(true);
                      try {
                        const res = await fetch(`/api/routes/${routeId}/speed`, {
                          method: 'PATCH',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${localStorage.getItem('tracktruck_token')}`,
                          },
                          body: JSON.stringify({
                            truckSpeedMph: 60,
                            customDurationS: customDurationMinutes > 0 ? customDurationMinutes * 60 : null,
                            customDurationEnabled: useCustomDuration,
                            showSpeedPublic,
                          }),
                        });
                        if (!res.ok) {
                          const err = await res.json().catch(() => ({}));
                          throw new Error(err.message || 'Failed to update speed');
                        }
                        toast({ title: "Settings Updated", description: "Speed settings have been saved." });
                        // Close the speed field after saving
                        setUseCustomDuration(false);
                        await refetchRoute();
                      } catch (err: any) {
                        toast({ title: "Update failed", description: err?.message || "Failed to update", variant: "destructive" });
                      } finally {
                        setSpeedSaving(false);
                      }
                    }}
                    disabled={speedSaving || !useCustomDuration}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-primary text-white hover:bg-primary/90 font-semibold text-sm transition-colors disabled:opacity-50 shadow-sm"
                  >
                    {speedSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Gauge className="w-3.5 h-3.5" />}
                    Update Speed Settings
                  </button>
                )}

                {/* Reset to default — only shown when a custom duration is saved */}
                {routeId && existingRoute && (existingRoute as any).customDurationEnabled && (
                  <button
                    onClick={async () => {
                      setSpeedSaving(true);
                      try {
                        const res = await fetch(`/api/routes/${routeId}/speed`, {
                          method: 'PATCH',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${localStorage.getItem('tracktruck_token')}`,
                          },
                          body: JSON.stringify({
                            customDurationS: null,
                            customDurationEnabled: false,
                          }),
                        });
                        if (!res.ok) {
                          const err = await res.json().catch(() => ({}));
                          throw new Error(err.message || 'Failed to reset');
                        }
                        toast({ title: "Speed Reset", description: "Simulation speed reset to map-based default." });
                        setUseCustomDuration(false);
                        setCustomDurationMinutes(30);
                        initializedRouteIdRef.current = null;
                        await refetchRoute();
                      } catch (err: any) {
                        toast({ title: "Reset failed", description: err?.message || "Failed to reset", variant: "destructive" });
                      } finally {
                        setSpeedSaving(false);
                      }
                    }}
                    disabled={speedSaving}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-border text-muted-foreground hover:bg-muted/40 font-semibold text-sm transition-colors disabled:opacity-50"
                  >
                    Reset to Default
                  </button>
                )}
              </div>
            </div>

            <hr className="border-border/50" />

            {/* Route Points */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Route Points *</h3>
                {mapboxToken && !routeLocked && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Click map to place
                  </span>
                )}
              </div>

              {/* Locked state: show current values with a Change Route button */}
              {routeLocked ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <div className="w-3.5 h-3.5 rounded-full bg-black border border-white ring-2 ring-black/20 shrink-0 mt-1" />
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground">Start Location</p>
                        <p className="text-sm font-bold text-foreground line-clamp-2 leading-tight mb-0.5">{start?.label ?? '—'}</p>
                        <p className="text-[10px] tabular-nums font-mono text-muted-foreground/80">{start?.lat.toFixed(6)}, {start?.lng.toFixed(6)}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <div className="w-3.5 h-3.5 rounded-full bg-primary shrink-0 flex items-center justify-center mt-1">
                        <Flag className="w-2 h-2 text-white" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground">End Location</p>
                        <p className="text-sm font-bold text-foreground line-clamp-2 leading-tight mb-0.5">{end?.label ?? '—'}</p>
                        <p className="text-[10px] tabular-nums font-mono text-muted-foreground/80">{end?.lat.toFixed(6)}, {end?.lng.toFixed(6)}</p>
                      </div>
                    </div>
                  </div>
                  {!isCompleted && (
                    <TooltipProvider delayDuration={0}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => setRouteChangeMode(true)}
                            disabled={modificationsRestricted}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-amber-400 bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold text-sm transition-colors disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed group relative"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Change Route
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="bg-slate-900 text-white border-none py-2 px-3 rounded-lg shadow-xl max-w-[220px]">
                          <p className="text-xs font-medium leading-relaxed">
                            {modificationsRestricted
                              ? "Activated routes can only be modified once."
                              : "Edit the current route path and stops"}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              ) : (
                /* Editable state */
                <>
                  {isLiveRoute && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700">Changing the start or end will reroute the live truck. Save to confirm.</p>
                    </div>
                  )}
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
                      <p className="text-[10px] tabular-nums font-mono text-emerald-600 mt-1 pl-1">
                        ✓ {start.lat.toFixed(6)}, {start.lng.toFixed(6)}
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
                      <p className="text-[10px] tabular-nums font-mono text-emerald-600 mt-1 pl-1">
                        ✓ {end.lat.toFixed(6)}, {end.lng.toFixed(6)}
                      </p>
                    )}
                  </div>

                  {isLiveRoute && (
                    <button
                      onClick={() => {
                        // Revert local state to match DB
                        if (existingRoute) {
                          setStart({ lng: existingRoute.startLng, lat: existingRoute.startLat, label: `${existingRoute.startLat.toFixed(4)}, ${existingRoute.startLng.toFixed(4)}` });
                          setEnd({ lng: existingRoute.endLng, lat: existingRoute.endLat, label: `${existingRoute.endLat.toFixed(4)}, ${existingRoute.endLng.toFixed(4)}` });
                          setStops(existingRoute.stops.map(s => ({
                            id: `db-${s.id}`, name: s.name, lat: s.lat, lng: s.lng,
                            durationMinutes: s.durationMinutes, dbId: s.id,
                          })));
                          // Restore the saved route polyline
                          if (existingRoute.polyline?.length) {
                            setRouteOptions([{
                              polyline: existingRoute.polyline,
                              distanceM: existingRoute.distanceM || 0,
                              durationS: existingRoute.estimatedDurationS || 0,
                              speedProfile: existingRoute.speedProfile ?? [],
                            }]);
                            setSelectedIdx(0);
                          }
                        }
                        setRouteChangeMode(false);
                      }}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-border bg-muted hover:bg-muted/80 text-muted-foreground font-medium text-sm transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                      Cancel
                    </button>
                  )}
                </>
              )}
            </div>

            <hr className="border-border/50" />

            {/* Routing error — persistent inline message when no road route found */}
            {!isRouting && routingError && routeOptions.length === 0 && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
                <p className="text-xs font-semibold text-destructive mb-0.5">No road route found</p>
                <p className="text-xs text-destructive/80">{routingError}</p>
              </div>
            )}

            {/* Route Alternatives — always visible when options exist */}
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
                            className={`w-full text-left rounded-xl border p-3 transition-all ${isSelected
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
              </div>

              <button
                onClick={() => { setShowAddStop(!showAddStop); setMapClick(null); }}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm ${showAddStop
                  ? 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200'
                  : 'bg-primary text-white hover:bg-primary/90 shadow-primary/20'
                  }`}
              >
                {showAddStop ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {showAddStop ? 'Done Adding Stops' : 'Add Stop'}
              </button>

              {showAddStop && (
                <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-medium text-foreground">Search by name or click the map to drop a stop:</p>
                  <AddressSearch
                    placeholder="e.g. Port, Warehouse, Checkpoint..."
                    mapboxToken={mapboxToken}
                    onSelect={handleAddStop}
                  />
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
                          atStopName={atStopName}
                          countdownSec={atStopName === stop.name ? countdownSec : null}
                          onRemove={(id) => {
                            setStops(s => {
                              const removing = s.find(x => x.id === id);
                              if (isLiveRoute && removing?.dbId) {
                                deleteStopFromDb(removing.dbId);
                              }
                              return s.filter(x => x.id !== id);
                            });
                          }}
                          onChangeName={(id, val) => setStops(s => s.map(x => x.id === id ? { ...x, name: val } : x))}
                          onChangeDuration={(id, val) => {
                            setStops(s => s.map(x => {
                              if (x.id !== id) return x;
                              if (isLiveRoute && x.dbId && routeId) {
                                fetch(`/api/routes/${routeId}/stops/${x.dbId}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('tracktruck_token')}` },
                                  body: JSON.stringify({ durationMinutes: val }),
                                }).catch(() => { });
                              }
                              return { ...x, durationMinutes: val };
                            }));
                          }}
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
                {/* Status Indicator */}
                {liveSnapshot && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-100 border border-emerald-200 w-fit mb-4">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Live tracking active</span>
                  </div>
                )}

                {!isActivatedRoute && (
                  <p className="text-xs text-emerald-600/70 mt-2">Real road geometry · {routeOptions.length} option{routeOptions.length !== 1 ? 's' : ''} found</p>
                )}
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
                longitude: start?.lng ?? -98.5795,
                latitude: start?.lat ?? 39.8283,
                zoom: start ? 7 : 4,
              }}
              mapStyle="mapbox://styles/mapbox/streets-v12"
              projection={{ name: 'mercator' }}
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
                      paint={{ 'line-color': '#94a3b8', 'line-width': 4, 'line-opacity': 0.9 }}
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
                    paint={{ 'line-color': '#3b3ef4', 'line-width': 6, 'line-opacity': 1 }}
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
                <Marker longitude={end.lng} latitude={end.lat} anchor="bottom">
                  <div className="flex flex-col items-center">
                    <div className="w-9 h-9 bg-red-500 rounded-full flex items-center justify-center text-white shadow-xl border-2 border-white">
                      <Flag className="w-4 h-4 fill-current" />
                    </div>
                    <div className="w-0.5 h-3 bg-red-500" />
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

              {/* Live truck marker (admin view, in_progress only) — smoothly interpolated */}
              <AnimatedTruckMarker snapshot={liveSnapshot} />

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
              {showAddStop ? (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-none z-10">
                  <div className="bg-primary/90 text-white text-xs font-medium px-4 py-2 rounded-full flex items-center gap-2 shadow-lg backdrop-blur-sm">
                    <Plus className="w-3.5 h-3.5" />
                    Click anywhere on the map to drop a stop marker
                  </div>
                </div>
              ) : !start && !end ? (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-none">
                  <div className="bg-black/70 text-white text-xs font-medium px-4 py-2 rounded-full flex items-center gap-2 shadow-lg backdrop-blur-sm">
                    <MapPin className="w-3.5 h-3.5" />
                    Click anywhere on the map to place start or end points
                  </div>
                </div>
              ) : null}
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

      {/* Confirmation modal for changing a live route */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowConfirmModal(false)} />
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground mb-1">Change the live route?</h2>
                <p className="text-sm text-muted-foreground">
                  This will immediately reroute the truck and update the shared tracking link for all viewers. The current truck position will be reset to the start of the new route.
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirmModal(false)}
                disabled={isSaving}
                className="px-4 py-2 rounded-xl border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 font-semibold text-sm transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowConfirmModal(false);
                  await handleSave(false, true);
                  setRouteChangeMode(false);
                  refetchRoute();
                }}
                disabled={isSaving}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Yes, change route
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
