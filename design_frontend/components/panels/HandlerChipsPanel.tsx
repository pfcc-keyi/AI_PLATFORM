"use client";

import { motion } from "framer-motion";
import { Cog, Workflow, Loader2 } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import type { HandlerSketch } from "@/lib/types";

interface HandlerChipsPanelProps {
  handlers: HandlerSketch[];
  loading?: boolean;
  emptyMessage?: string;
}

export function HandlerChipsPanel({
  handlers,
  loading = false,
  emptyMessage = "No handler suggestions yet."
}: HandlerChipsPanelProps) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Asking the AI for handler suggestions...
      </div>
    );
  }

  if (!handlers.length) {
    return <div className="text-sm text-muted">{emptyMessage}</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {handlers.map((h, i) => (
        <motion.div
          key={`${h.handler_name}-${i}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: i * 0.03 }}
          className="flex flex-col gap-1 rounded-lg border border-border bg-surfaceAlt/60 p-3"
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <Cog className="h-4 w-4 text-accent" />
            <code className="font-mono">{h.handler_name}</code>
            <Badge variant={h.mode === "async" ? "warning" : "muted"}>
              {h.mode || "sync"}
            </Badge>
          </div>
          {h.description ? (
            <div className="text-xs text-muted">{h.description}</div>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {h.trigger_state ? (
              <Badge variant="accent">
                <Workflow className="h-3 w-3" />
                {h.trigger_state} -&gt; {h.target_state || "?"}
              </Badge>
            ) : null}
            {(h.tables_used || []).map((t) => (
              <Badge key={t} variant="muted">{t}</Badge>
            ))}
            {(h.fields_touched || []).map((f) => (
              <Badge key={`f-${f}`} variant="default">{f}</Badge>
            ))}
          </div>
          {h.reasoning ? (
            <div className="text-[11px] italic text-muted">{h.reasoning}</div>
          ) : null}
        </motion.div>
      ))}
    </div>
  );
}
