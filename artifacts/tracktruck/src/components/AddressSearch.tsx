import { useState, useRef, useEffect } from "react";
import { Search, Loader2, MapPin } from "lucide-react";

interface Suggestion {
  id: string;
  name: string;
  fullName: string;
  lng: number;
  lat: number;
}

interface AddressSearchProps {
  placeholder?: string;
  value?: string;
  onSelect: (result: { placeName: string; lng: number; lat: number }) => void;
  mapboxToken?: string;
  className?: string;
}

async function searchMapbox(query: string, token: string): Promise<Suggestion[]> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&limit=6&types=place,locality,address,poi,district,region`;
  const res = await fetch(url);
  const data = await res.json();
  return (data.features || []).map((f: any) => ({
    id: f.id,
    name: f.text || f.place_name.split(",")[0],
    fullName: f.place_name,
    lng: f.center[0],
    lat: f.center[1],
  }));
}

async function searchNominatim(query: string): Promise<Suggestion[]> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&addressdetails=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "TrackTruck-Live/1.0 (route-tracking-app)" },
  });
  const data = await res.json();
  return data.map((f: any, i: number) => ({
    id: `nom-${i}-${f.place_id}`,
    name: f.name || f.display_name.split(",")[0].trim(),
    fullName: f.display_name,
    lng: parseFloat(f.lon),
    lat: parseFloat(f.lat),
  }));
}

export function AddressSearch({
  placeholder = "Search location...",
  value,
  onSelect,
  mapboxToken,
  className = "",
}: AddressSearchProps) {
  const [query, setQuery] = useState(value || "");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);
  const isFocused = useRef(false);
  const suppressSearch = useRef(false);

  useEffect(() => {
    if (value !== undefined && value !== query && !isFocused.current) {
      suppressSearch.current = true;
      setQuery(value);
    }
  }, [value]);

  useEffect(() => {
    clearTimeout(debounceRef.current);

    if (suppressSearch.current) {
      suppressSearch.current = false;
      return;
    }

    if (!query.trim() || query.length < 2) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const results = mapboxToken
          ? await searchMapbox(query, mapboxToken)
          : await searchNominatim(query);
        setSuggestions(results);
        setIsOpen(results.length > 0);
      } catch {
        setSuggestions([]);
        setIsOpen(false);
      } finally {
        setIsLoading(false);
      }
    }, 350);

    return () => clearTimeout(debounceRef.current);
  }, [query, mapboxToken]);

  const handleSelect = (s: Suggestion) => {
    setQuery(s.fullName);
    setIsOpen(false);
    setSuggestions([]);
    onSelect({ placeName: s.fullName, lng: s.lng, lat: s.lat });
  };

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { isFocused.current = true; suggestions.length > 0 && setIsOpen(true); }}
          onBlur={() => { isFocused.current = false; setTimeout(() => setIsOpen(false), 150); }}
          placeholder={placeholder}
          className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-background border border-border focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all text-sm"
        />
        {isLoading ? (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {isOpen && suggestions.length > 0 && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              className="w-full flex items-start gap-3 px-4 py-3 hover:bg-muted transition-colors text-left border-b border-border/30 last:border-0"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(s);
              }}
            >
              <MapPin className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium text-foreground text-sm truncate">{s.name}</div>
                <div className="text-xs text-muted-foreground line-clamp-1">{s.fullName}</div>
              </div>
            </button>
          ))}
          {!mapboxToken && (
            <div className="px-4 py-2 bg-muted/30 text-xs text-muted-foreground border-t border-border/30">
              Results via OpenStreetMap · Add Mapbox token for better results
            </div>
          )}
        </div>
      )}
    </div>
  );
}
