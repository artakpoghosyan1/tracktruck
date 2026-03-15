import { useState } from "react";
import { useAppStore } from "@/store/use-app-store";
import { MapPin, KeyRound, CheckCircle2, X } from "lucide-react";

export function MapboxPrompt() {
  const { mapboxToken, setMapboxToken, mapboxPromptOpen, closeMapboxPrompt } = useAppStore();
  const [tokenInput, setTokenInput] = useState(mapboxToken || "");

  if (!mapboxPromptOpen) return null;

  const handleSave = () => {
    if (tokenInput.trim()) {
      setMapboxToken(tokenInput.trim());
      closeMapboxPrompt();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="bg-card w-full max-w-md p-8 rounded-3xl shadow-2xl border border-border/50 animate-in fade-in zoom-in duration-300 relative">
        <button
          onClick={closeMapboxPrompt}
          className="absolute top-4 right-4 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
          <MapPin className="w-6 h-6 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Mapbox Token</h2>
        <p className="text-muted-foreground mb-6 text-sm">
          Enter your Mapbox public token to enable map display and turn-by-turn directions.
          Address search works without a token using OpenStreetMap.
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-semibold text-foreground mb-1 block">Public Token (pk.ey...)</label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <input
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                placeholder="Paste your token here"
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-background border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none text-foreground text-sm"
              />
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={!tokenInput.trim()}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-semibold transition-all disabled:opacity-50"
          >
            <CheckCircle2 className="w-5 h-5" />
            Save Token
          </button>

          <button
            onClick={closeMapboxPrompt}
            className="w-full py-2.5 px-4 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-colors font-medium"
          >
            Skip (map disabled, address search still works)
          </button>
        </div>
        <div className="mt-4 text-xs text-center text-muted-foreground">
          Get a free token at{" "}
          <a href="https://mapbox.com" target="_blank" rel="noreferrer" className="text-primary hover:underline">
            mapbox.com
          </a>
        </div>
      </div>
    </div>
  );
}
