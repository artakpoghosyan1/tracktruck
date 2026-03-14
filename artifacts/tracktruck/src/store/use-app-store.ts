import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  mapboxToken: string;
  setMapboxToken: (token: string) => void;
  isAuthenticated: boolean;
  setAuthenticated: (status: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      mapboxToken: '',
      setMapboxToken: (token) => set({ mapboxToken: token }),
      isAuthenticated: !!localStorage.getItem('tracktruck_token'),
      setAuthenticated: (status) => set({ isAuthenticated: status }),
    }),
    {
      name: 'tracktruck-storage',
    }
  )
);
