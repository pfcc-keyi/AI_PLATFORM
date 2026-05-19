"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface ResizableRailProps {
  /** localStorage key so each user keeps their preferred width across sessions. */
  storageKey: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

/**
 * Right-anchored resizable panel with a drag handle on its LEFT edge.
 * - Width persists to localStorage under `storageKey`.
 * - Drag handle is a 4px hit area but visually a thin coloured strip on hover.
 * - Double-click the handle to reset to `defaultWidth`.
 */
export function ResizableRail({
  storageKey,
  defaultWidth = 380,
  minWidth = 320,
  maxWidth = 720,
  className,
  style,
  children
}: ResizableRailProps) {
  const [width, setWidth] = React.useState<number>(defaultWidth);
  const [dragging, setDragging] = React.useState(false);
  const startX = React.useRef(0);
  const startW = React.useRef(0);
  const lastWrittenRef = React.useRef<number>(defaultWidth);

  // Hydrate from localStorage on mount (client-only).
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const n = Number.parseInt(stored, 10);
        if (Number.isFinite(n)) {
          const clamped = Math.min(maxWidth, Math.max(minWidth, n));
          setWidth(clamped);
          lastWrittenRef.current = clamped;
        }
      }
    } catch {
      /* ignore */
    }
  }, [storageKey, minWidth, maxWidth]);

  // Persist width when it changes (debounced via animation-frame batching).
  React.useEffect(() => {
    if (lastWrittenRef.current === width) return;
    lastWrittenRef.current = width;
    try {
      window.localStorage.setItem(storageKey, String(width));
    } catch {
      /* ignore */
    }
  }, [storageKey, width]);

  React.useEffect(() => {
    if (!dragging) return;
    function onMove(ev: MouseEvent) {
      // Right-anchored: dragging left increases width.
      const delta = startX.current - ev.clientX;
      const next = Math.min(
        maxWidth,
        Math.max(minWidth, startW.current + delta)
      );
      setWidth(next);
    }
    function onUp() {
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
    };
  }, [dragging, maxWidth, minWidth]);

  function startDrag(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    startX.current = e.clientX;
    startW.current = width;
    setDragging(true);
  }

  return (
    <aside
      className={cn(
        "pointer-events-auto group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface/85 backdrop-blur",
        className
      )}
      style={{ ...style, width }}
    >
      {/* Drag handle (left edge). 6px wide hit area, 2px visible strip on hover. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
        tabIndex={0}
        onMouseDown={startDrag}
        onDoubleClick={() => setWidth(defaultWidth)}
        onKeyDown={(e) => {
          // Keyboard resizing: ←/→ ±20px, shift for ±60px
          const step = e.shiftKey ? 60 : 20;
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            setWidth((w) => Math.min(maxWidth, w + step));
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            setWidth((w) => Math.max(minWidth, w - step));
          } else if (e.key === "Home") {
            e.preventDefault();
            setWidth(defaultWidth);
          }
        }}
        data-testid="rail-resize-handle"
        title="Drag to resize · Double-click to reset · ←/→ keys to resize"
        className={cn(
          "absolute left-0 top-0 z-20 h-full w-1.5 cursor-col-resize",
          "before:absolute before:left-0 before:top-1/2 before:h-12 before:w-1 before:-translate-y-1/2 before:rounded-r-full",
          "before:bg-border before:transition-all",
          "hover:before:bg-accent hover:before:w-1.5 hover:before:h-20",
          dragging && "before:bg-accent before:w-1.5 before:h-20"
        )}
        style={{ touchAction: "none" }}
      />
      {children}
    </aside>
  );
}
