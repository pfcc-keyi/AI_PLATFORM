"use client";

import { useEffect } from "react";
import { eventsUrl } from "./api";
import { useEventsStore } from "@/store/eventsStore";
import type { StreamEvent } from "./types";

/**
 * Subscribe to the per-design SSE stream and push every event into the
 * eventsStore. Returns nothing — components read events from the store.
 */
export function useDesignStream(designId: string | undefined) {
  const push = useEventsStore((s) => s.push);
  const setPhase = useEventsStore((s) => s.setPhase);

  useEffect(() => {
    if (!designId) return;
    const src = new EventSource(eventsUrl(designId));
    src.onmessage = (msg) => {
      if (!msg.data) return;
      try {
        const event = JSON.parse(msg.data) as StreamEvent;
        push(event);
        if (event.type === "phase") {
          setPhase(event.phase);
        }
      } catch {
        // ignore non-JSON keepalive payloads
      }
    };
    src.onerror = () => {
      // Browser will auto-reconnect; nothing to do here.
    };
    return () => src.close();
  }, [designId, push, setPhase]);
}
