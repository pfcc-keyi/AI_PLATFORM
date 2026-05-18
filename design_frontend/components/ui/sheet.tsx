"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: "right" | "left" | "bottom";
  title?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}

const sideStyles = {
  right: "right-0 top-0 h-full",
  left: "left-0 top-0 h-full",
  bottom: "left-0 right-0 bottom-0"
} as const;

const sideMotion = {
  right: { initial: { x: 40 }, animate: { x: 0 }, exit: { x: 40 } },
  left: { initial: { x: -40 }, animate: { x: 0 }, exit: { x: -40 } },
  bottom: { initial: { y: 40 }, animate: { y: 0 }, exit: { y: 40 } }
} as const;

export function Sheet({
  open,
  onOpenChange,
  side = "right",
  title,
  children,
  width = "420px"
}: SheetProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => onOpenChange(false)}
          />
          <motion.aside
            className={cn(
              "fixed z-50 bg-surface border border-border shadow-glow overflow-hidden flex flex-col",
              sideStyles[side]
            )}
            style={side === "bottom" ? { maxHeight: "70vh" } : { width }}
            initial={{ ...sideMotion[side].initial, opacity: 0 }}
            animate={{ ...sideMotion[side].animate, opacity: 1 }}
            exit={{ ...sideMotion[side].exit, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="text-sm font-semibold">{title}</div>
              <button
                className="text-muted hover:text-text transition-colors"
                onClick={() => onOpenChange(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
