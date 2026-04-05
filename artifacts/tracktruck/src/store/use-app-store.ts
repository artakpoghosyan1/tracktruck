import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const ENV_MAPBOX_TOKEN = (import.meta as any).env?.VITE_MAPBOX_TOKEN || '';

interface User {
  id: number;
  email: string;
  name: string;
  role: 'super_admin' | 'admin' | 'user';
}

interface AppState {
  mapboxToken: string;
  setMapboxToken: (token: string) => void;
  isAuthenticated: boolean;
  user: User | null;
  setAuthenticated: (status: boolean, user?: User | null) => void;
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
      user: null,
      setAuthenticated: (status, user = null) => set({ isAuthenticated: status, user }),
      mapboxPromptOpen: false,
      openMapboxPrompt: () => set({ mapboxPromptOpen: true }),
      closeMapboxPrompt: () => set({ mapboxPromptOpen: false }),
    }),
    {
      name: 'tracktruck-storage',
      partialize: (state) => ({
        mapboxToken: state.mapboxToken,
        isAuthenticated: state.isAuthenticated,
        user: state.user,
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
