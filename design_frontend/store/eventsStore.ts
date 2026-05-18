import { create } from "zustand";
import type { StreamEvent } from "@/lib/types";

interface EventsState {
  events: StreamEvent[];
  phase: string;
  push: (event: StreamEvent) => void;
  setPhase: (phase: string) => void;
  clear: () => void;
}

const MAX_EVENTS = 400;

export const useEventsStore = create<EventsState>((set) => ({
  events: [],
  phase: "",
  push: (event) =>
    set((state) => {
      const next = state.events.length >= MAX_EVENTS
        ? [...state.events.slice(state.events.length - MAX_EVENTS + 1), event]
        : [...state.events, event];
      return { events: next };
    }),
  setPhase: (phase) => set({ phase }),
  clear: () => set({ events: [], phase: "" })
}));
