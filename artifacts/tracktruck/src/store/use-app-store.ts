import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const ENV_MAPBOX_TOKEN = (import.meta as any).env?.VITE_MAPBOX_TOKEN || '';

interface AppState {
  mapboxToken: string;
  setMapboxToken: (token: string) => void;
  isAuthenticated: boolean;
  setAuthenticated: (status: boolean) => void;
  mapboxPromptOpen: boolean;
  openMapboxPrompt: () => void;
  closeMapboxPrompt: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      mapboxToken: ENV_MAPBOX_TOKEN,
      setMapboxToken: (token) => set({ mapboxToken: token }),
      isAuthenticated: !!localStorage.getItem('tracktruck_token'),
      setAuthenticated: (status) => set({ isAuthenticated: status }),
      mapboxPromptOpen: false,
      openMapboxPrompt: () => set({ mapboxPromptOpen: true }),
      closeMapboxPrompt: () => set({ mapboxPromptOpen: false }),
    }),
    {
      name: 'tracktruck-storage',
      partialize: (state) => ({
        mapboxToken: state.mapboxToken,
        isAuthenticated: state.isAuthenticated,
      }),
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        mapboxToken: ENV_MAPBOX_TOKEN || persisted?.mapboxToken || '',
        mapboxPromptOpen: !ENV_MAPBOX_TOKEN && !persisted?.mapboxToken,
      }),
    }
  )
);
