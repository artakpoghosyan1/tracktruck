import { useState, useEffect, useRef, useMemo } from "react";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { format } from "date-fns";
import { Clock, AlertTriangle, X, MapPin } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  durationMinutes: number;
  dbId?: number;
  stopType?: string;
}

interface LiveSnapshot {
  distanceTraveledM?: number;
  progressPercent?: number;
  speedMph?: number;
}

interface SuggestedStop {
  name: string;
  lat: number;
  lng: number;
  durationMinutes: number;
  stopType: "pacing";
}

interface EtaWidgetProps {
  endLat: number | null;
  endLng: number | null;
  distanceM: number;
  estimatedDurationS: number;
  stops: Stop[];
  etaTargetUtc: string | null;
  etaTimezone: string | null;
  routeStatus: string;
  liveSnapshot?: LiveSnapshot | null;
  onEtaChange: (etaUtc: string | null, timezone: string | null) => void;
  onAddSuggestedStops: (stops: SuggestedStop[]) => void | Promise<void>;
  polyline: number[][];
  disabled?: boolean;
}

const US_TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time" },
  { value: "America/Chicago", label: "Central Time" },
  { value: "America/Denver", label: "Mountain Time" },
  { value: "America/Phoenix", label: "Mountain Time (no DST)" },
  { value: "America/Los_Angeles", label: "Pacific Time" },
  { value: "America/Anchorage", label: "Alaska Time" },
  { value: "Pacific/Honolulu", label: "Hawaii Time" },
];

const MAX_SINGLE_STOP_DWELL_S = 7200; // 2 hours

function interpolatePolylinePoint(polyline: number[][], fraction: number): { lat: number; lng: number } {
  if (!polyline || polyline.length < 2) return { lat: 0, lng: 0 };
  fraction = Math.max(0, Math.min(1, fraction));
  // compute total length
  let totalLen = 0;
  const lens: number[] = [];
  for (let i = 1; i < polyline.length; i++) {
    const dx = polyline[i][0] - polyline[i - 1][0];
    const dy = polyline[i][1] - polyline[i - 1][1];
    const len = Math.sqrt(dx * dx + dy * dy);
    lens.push(len);
    totalLen += len;
  }
  if (totalLen === 0) return { lat: polyline[0][1], lng: polyline[0][0] };
  let target = fraction * totalLen;
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i]) {
      const t = lens[i] > 0 ? target / lens[i] : 0;
      const lng = polyline[i][0] + t * (polyline[i + 1][0] - polyline[i][0]);
      const lat = polyline[i][1] + t * (polyline[i + 1][1] - polyline[i][1]);
      return { lat, lng };
    }
    target -= lens[i];
  }
  const last = polyline[polyline.length - 1];
  return { lat: last[1], lng: last[0] };
}

export function EtaWidget({
  endLat,
  endLng,
  distanceM,
  estimatedDurationS,
  stops,
  etaTargetUtc,
  etaTimezone,
  routeStatus,
  liveSnapshot,
  onEtaChange,
  onAddSuggestedStops,
  polyline,
  disabled = false,
}: EtaWidgetProps) {
  const [detectedTimezone, setDetectedTimezone] = useState<string | null>(null);
  const [detectedLabel, setDetectedLabel] = useState<string>("");
  const [selectedTimezone, setSelectedTimezone] = useState<string>("");
  const [dateValue, setDateValue] = useState(format(new Date(), "yyyy-MM-dd"));
  const [hourValue, setHourValue] = useState("");
  const [minuteValue, setMinuteValue] = useState("00");
  const [ampmValue, setAmpmValue] = useState<"AM" | "PM">("AM");
  const [isDismissed, setIsDismissed] = useState(false);
  const [isLoadingTz, setIsLoadingTz] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the last "timezone:duration" key used for auto-prefill.
  // Re-prefills when timezone changes (detection) OR route duration changes (recalculation).
  // Does NOT re-prefill on every live snapshot tick, so user edits are preserved.
  const prefillKeyRef = useRef<string | null>(null);

  // Computed early so it can be used in effects below
  // (selectedTimezone is set explicitly; detectedTimezone is set after fetch)
  const activeTimezone = selectedTimezone || detectedTimezone || "America/New_York";

  // Convert 12h components to 24h "HH:mm" string for fromZonedTime
  const timeValue = (() => {
    if (!hourValue) return "";
    const h = parseInt(hourValue);
    let h24 = h;
    if (ampmValue === "AM" && h === 12) h24 = 0;
    if (ampmValue === "PM" && h !== 12) h24 = h + 12;
    return `${String(h24).padStart(2, "0")}:${minuteValue}`;
  })();

  // Shared helper: apply a UTC date to the 12h form fields in the given timezone
  const applyDateToForm = (date: Date, tz: string) => {
    try {
      const localStr = formatInTimeZone(date, tz, "yyyy-MM-dd HH:mm");
      const [d, t] = localStr.split(" ");
      setDateValue(d ?? format(new Date(), "yyyy-MM-dd"));
      if (t) {
        const [hStr, mStr] = t.split(":");
        const h24 = parseInt(hStr);
        const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
        setHourValue(String(h12));
        setMinuteValue(mStr ?? "00");
        setAmpmValue(h24 >= 12 ? "PM" : "AM");
      }
    } catch { }
  };

  // Initialize form from saved ETA, or auto-prefill with estimated natural arrival.
  // prefillKeyRef ("tz:durationS") prevents overwriting user edits on live snapshot ticks
  // while still re-prefilling when the timezone is detected or the route is recalculated.
  useEffect(() => {
    if (etaTargetUtc && etaTimezone) {
      setSelectedTimezone(etaTimezone);
      applyDateToForm(new Date(etaTargetUtc), etaTimezone);
      prefillKeyRef.current = null; // allow re-prefill if ETA is later cleared
      return;
    }
    // No saved ETA — auto-prefill with natural estimated arrival in destination timezone
    if (!activeTimezone || estimatedDurationS <= 0) return;
    const key = `${activeTimezone}:${estimatedDurationS}`;
    if (prefillKeyRef.current === key) return;
    prefillKeyRef.current = key;

    const remainingNaturalS = isInProgress && liveSnapshot?.distanceTraveledM != null && distanceM > 0
      ? estimatedDurationS * Math.max(0, distanceM - liveSnapshot.distanceTraveledM) / distanceM
      : estimatedDurationS;
    const totalStopDwellS = stops.reduce((sum, s) => sum + s.durationMinutes * 60, 0);
    applyDateToForm(new Date(Date.now() + (remainingNaturalS + totalStopDwellS) * 1000), activeTimezone);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etaTargetUtc, etaTimezone, activeTimezone, estimatedDurationS]);

  // Fetch timezone when endpoint changes
  useEffect(() => {
    if (endLat == null || endLng == null) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setIsLoadingTz(true);
      try {
        const token = localStorage.getItem("tracktruck_token");
        const res = await fetch(`/api/utils/timezone?lat=${endLat}&lng=${endLng}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data: { timezone: string; label: string } = await res.json();
          setDetectedTimezone(data.timezone);
          setDetectedLabel(data.label);
          if (!etaTimezone) {
            setSelectedTimezone(data.timezone);
          }
        }
      } catch {
        // ignore fetch errors
      } finally {
        setIsLoadingTz(false);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [endLat, endLng, etaTimezone]);

  // Reset dismissed state when ETA inputs change
  useEffect(() => {
    setIsDismissed(false);
  }, [dateValue, hourValue, minuteValue, ampmValue, selectedTimezone]);

  // Reset dismissed when a stop is removed so a fresh suggestion appears
  const prevStopCountRef = useRef(stops.length);
  useEffect(() => {
    if (stops.length < prevStopCountRef.current) {
      setIsDismissed(false);
    }
    prevStopCountRef.current = stops.length;
  }, [stops.length]);

  const etaUtcMoment = useMemo(() => {
    if (!dateValue || !timeValue || !activeTimezone) return null;
    try {
      const localDateTimeStr = `${dateValue}T${timeValue}:00`;
      return fromZonedTime(new Date(localDateTimeStr), activeTimezone);
    } catch {
      return null;
    }
  }, [dateValue, timeValue, activeTimezone]);

  const isFuture = etaUtcMoment ? etaUtcMoment.getTime() > Date.now() : false;

  const tripDurationMs = etaUtcMoment ? etaUtcMoment.getTime() - Date.now() : null;
  const tripDurationHours = tripDurationMs ? tripDurationMs / 1000 / 3600 : null;

  // Use remaining distance when route is in_progress
  const isInProgress = routeStatus === "in_progress";
  const effectiveDistanceM = isInProgress && liveSnapshot?.distanceTraveledM != null
    ? Math.max(0, distanceM - liveSnapshot.distanceTraveledM)
    : distanceM;

  const suggestion = useMemo(() => {
    if (!etaUtcMoment || !isFuture || estimatedDurationS <= 0) return null;
    // No room to place stops ahead of the truck when it's past 94% of the route
    const progressFraction = isInProgress && liveSnapshot?.progressPercent != null
      ? liveSnapshot.progressPercent / 100 : 0;
    if (isInProgress && progressFraction >= 0.94) return null;
    const etaDurationS = (etaUtcMoment.getTime() - Date.now()) / 1000;
    // Only count pacing stops — regular stops are user waypoints and don't affect ETA speed
    const existingPacingDwellS = stops
      .filter(st => st.stopType === "pacing")
      .reduce((s, st) => s + st.durationMinutes * 60, 0);

    const requiredMovingTimeS = etaDurationS - existingPacingDwellS;
    if (requiredMovingTimeS <= 0) return null;

    // Remaining natural travel time: use distance ratio when available, otherwise fraction of total
    const remainingFraction = isInProgress
      ? (distanceM > 0 && liveSnapshot?.distanceTraveledM != null
          ? Math.max(0, (distanceM - liveSnapshot.distanceTraveledM) / distanceM)
          : Math.max(0, 1 - progressFraction))
      : 1;
    const remainingNaturalTravelTimeS = remainingFraction * estimatedDurationS;

    // Speed-based check when distance data is available; time-based fallback otherwise
    let requiredSpeedMph: number | null = null;
    let naturalSpeedMph: number | null = null;
    if (distanceM > 0 && effectiveDistanceM > 0) {
      naturalSpeedMph = (distanceM / 1609.34) / (estimatedDurationS / 3600);
      requiredSpeedMph = (effectiveDistanceM / 1609.34) / (requiredMovingTimeS / 3600);
      // Only suggest if ETA forces the truck meaningfully below natural speed
      if (requiredSpeedMph >= naturalSpeedMph * 0.9) return null;
    } else {
      // No usable distance data — check that ETA meaningfully exceeds natural remaining time
      if (requiredMovingTimeS >= remainingNaturalTravelTimeS * 0.9) return null;
    }

    // Extra pacing dwell needed so the truck can keep traveling at natural speed
    const additionalDwellNeeded = etaDurationS - existingPacingDwellS - remainingNaturalTravelTimeS;
    if (additionalDwellNeeded < 60) return null;

    const stopCount = Math.max(1, Math.ceil(additionalDwellNeeded / MAX_SINGLE_STOP_DWELL_S));
    const dwellPerStopMin = Math.ceil(additionalDwellNeeded / stopCount / 60);
    return {
      stopCount,
      dwellPerStopMin,
      requiredSpeedMph: requiredSpeedMph != null ? Math.round(requiredSpeedMph) : null,
      naturalSpeedMph: naturalSpeedMph != null ? Math.round(naturalSpeedMph) : null,
    };
  }, [etaUtcMoment, isFuture, effectiveDistanceM, distanceM, estimatedDurationS, stops, isInProgress, liveSnapshot?.progressPercent, liveSnapshot?.distanceTraveledM]);

  const handleSaveEta = () => {
    if (!etaUtcMoment || !isFuture) return;
    onEtaChange(etaUtcMoment.toISOString(), activeTimezone);
  };

  const handleClearEta = () => {
    setDateValue(format(new Date(), "yyyy-MM-dd"));
    setHourValue("");
    setMinuteValue("00");
    setAmpmValue("AM");
    setIsDismissed(false);
    onEtaChange(null, null);
  };

  const handleAddSuggestedStops = () => {
    if (!suggestion || polyline.length < 2) return;

    const currentFraction = isInProgress && liveSnapshot?.progressPercent != null
      ? liveSnapshot.progressPercent / 100
      : 0;
    // Always start ahead of the truck; end near (but not at) the destination.
    const startFraction = currentFraction + 0.05;
    const endFraction = Math.min(Math.max(startFraction + 0.05, 0.93), 0.99);
    if (startFraction >= endFraction) return;

    // Cap stop count so stops aren't crowded: each stop needs at least 5% of total
    // route distance (or 1km) of breathing room.
    const rangeDistanceM = (endFraction - startFraction) * distanceM;
    const minSpacingM = Math.max(distanceM * 0.05, 1000);
    const maxStopsBySpace = Math.max(1, Math.floor(rangeDistanceM / minSpacingM));
    const stopCount = Math.min(suggestion.stopCount, maxStopsBySpace);

    // Recompute dwell using the actual stop count at click time (avoids stale useMemo
    // Date.now() inflating totalStopDwellS and pushing speedMultiplier above 1.0).
    let dwellPerStopMin = Math.ceil((suggestion.stopCount * suggestion.dwellPerStopMin) / stopCount);
    if (etaUtcMoment) {
      const freshEtaDurationS = (etaUtcMoment.getTime() - Date.now()) / 1000;
      if (freshEtaDurationS > 0) {
        // Only pacing stop dwell counts toward the speed multiplier
        const existingPacingDwellS = stops
          .filter(st => st.stopType === "pacing")
          .reduce((s, st) => s + (st.durationMinutes ?? 0) * 60, 0);
        const freshRemainingNaturalS = distanceM > 0
          ? estimatedDurationS * (effectiveDistanceM / distanceM)
          : estimatedDurationS;
        const freshAdditionalDwell = Math.max(0, freshEtaDurationS - existingPacingDwellS - freshRemainingNaturalS);
        // Use floor so actual dwell never exceeds what's needed (prevents speedMultiplier > 1.0).
        const computed = Math.floor(freshAdditionalDwell / stopCount / 60);
        if (computed >= 1) dwellPerStopMin = computed;
      }
    }

    const suggestedStops: SuggestedStop[] = [];
    for (let i = 0; i < stopCount; i++) {
      const fraction = startFraction + (endFraction - startFraction) / (stopCount + 1) * (i + 1);
      const pos = interpolatePolylinePoint(polyline, fraction);
      suggestedStops.push({
        name: `Pacing Stop ${i + 1}`,
        lat: pos.lat,
        lng: pos.lng,
        durationMinutes: dwellPerStopMin,
        stopType: "pacing",
      });
    }
    onAddSuggestedStops(suggestedStops);
  };

  const tzLabel = US_TIMEZONES.find((tz) => tz.value === activeTimezone)?.label ?? detectedLabel ?? activeTimezone;
  const hasEta = !!etaTargetUtc;
  const isDirty = hasEta
    ? (etaUtcMoment?.toISOString() !== etaTargetUtc || activeTimezone !== etaTimezone)
    : (!!etaUtcMoment && isFuture);

  return (
    <div className="space-y-3">
      {/* Timezone display */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MapPin className="w-3 h-3" />
        {isLoadingTz ? (
          <span>Detecting timezone…</span>
        ) : (
          <span>
            Destination: <span className="font-semibold text-foreground">{tzLabel}</span>
          </span>
        )}
      </div>

      {/* Timezone override */}
      <select
        value={selectedTimezone}
        onChange={(e) => setSelectedTimezone(e.target.value)}
        className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none"
      >
        <option value="" disabled>Select timezone…</option>
        {US_TIMEZONES.map((tz) => (
          <option key={tz.value} value={tz.value}>{tz.label}</option>
        ))}
      </select>

      {/* Date + Time inputs */}
      <input
        type="date"
        value={dateValue}
        onChange={(e) => setDateValue(e.target.value)}
        min={format(new Date(), "yyyy-MM-dd")}
        className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none"
      />
      <div className="flex gap-1.5">
        <select
          value={hourValue}
          onChange={(e) => setHourValue(e.target.value)}
          className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-background text-sm focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none"
        >
          <option value="" disabled>Hour</option>
          {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((h) => (
            <option key={h} value={String(h)}>{h}</option>
          ))}
        </select>
        <select
          value={minuteValue}
          onChange={(e) => setMinuteValue(e.target.value)}
          className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-background text-sm focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none"
        >
          {["00", "15", "30", "45"].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select
          value={ampmValue}
          onChange={(e) => setAmpmValue(e.target.value as "AM" | "PM")}
          className="w-16 px-2 py-1.5 rounded-lg border border-border bg-background text-sm focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none"
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>

      {/* Computed duration display */}
      {etaUtcMoment && tripDurationHours != null && (
        <div className={`text-xs flex items-center gap-1.5 ${isFuture ? "text-muted-foreground" : "text-destructive"}`}>
          <Clock className="w-3 h-3 shrink-0" />
          {isFuture ? (
            <>
              Duration: <span className="font-semibold text-foreground">
                {Math.floor(tripDurationHours)}h {Math.round((tripDurationHours % 1) * 60)}m
              </span>
              {estimatedDurationS > 0 && (() => {
                const h = Math.floor(estimatedDurationS / 3600);
                const m = Math.round((estimatedDurationS % 3600) / 60);
                const label = h > 0 ? `${h}h ${m}m` : `${m}m`;
                return <span className="text-muted-foreground">(natural: {label})</span>;
              })()}
            </>
          ) : (
            "Arrival time must be in the future."
          )}
        </div>
      )}

      {/* Stop suggestion panel */}
      {suggestion && !isDismissed && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs font-semibold text-amber-900 leading-snug">
              This ETA requires ~{suggestion.requiredSpeedMph} mph instead of the natural ~{suggestion.naturalSpeedMph} mph.
            </p>
          </div>
          <p className="text-xs text-amber-800">
            Add <strong>{suggestion.stopCount} stop{suggestion.stopCount > 1 ? "s" : ""}</strong> ({suggestion.dwellPerStopMin} min each) to keep the truck moving at ~{suggestion.naturalSpeedMph} mph.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleAddSuggestedStops}
              className="flex-1 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors"
            >
              Add Suggested Stops
            </button>
            <button
              onClick={() => setIsDismissed(true)}
              className="px-2 py-1.5 rounded-lg border border-amber-300 text-amber-700 text-xs hover:bg-amber-100 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Advisory note when dismissed */}
      {suggestion && isDismissed && (
        <p className="text-xs text-amber-700 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          ETA saved — truck will move slower than realistic road speed.
        </p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={`flex-1 ${disabled ? 'cursor-not-allowed' : ''}`}>
                <button
                  onClick={handleSaveEta}
                  disabled={!isDirty || !isFuture || disabled}
                  className="w-full px-3 py-2 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none transition-colors"
                >
                  {hasEta ? "Update ETA" : "Set ETA"}
                </button>
              </span>
            </TooltipTrigger>
            {disabled && (
              <TooltipContent side="bottom" className="bg-slate-900 text-white border-none py-2 px-3 rounded-lg shadow-xl max-w-[220px]">
                <p className="text-xs font-medium leading-relaxed">Save route changes first</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
        {hasEta && (
          <button
            onClick={handleClearEta}
            className="px-3 py-2 rounded-xl border border-border text-muted-foreground text-sm hover:bg-muted/40 transition-colors"
          >
            Remove
          </button>
        )}
      </div>

      {/* Current ETA display */}
      {hasEta && etaTimezone && (
        <p className="text-xs text-muted-foreground">
          Current ETA:{" "}
          <span className="font-semibold text-foreground">
            {formatInTimeZone(new Date(etaTargetUtc!), etaTimezone, "MMM d, h:mm a zzz")}
          </span>
        </p>
      )}
    </div>
  );
}
