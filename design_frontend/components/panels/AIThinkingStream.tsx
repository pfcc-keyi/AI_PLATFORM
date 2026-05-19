"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Brain,
  CircleDot,
  CircleCheck,
  Cog,
  Network,
  Workflow
} from "lucide-react";
import * as React from "react";
import { useEventsStore } from "@/store/eventsStore";

const ICON_FOR: Record<string, React.ComponentType<{ className?: string }>> = {
  flow_started: Workflow,
  flow_finished: Workflow,
  method_started: Network,
  method_finished: Network,
  crew_started: Brain,
  crew_completed: Brain,
  task_started: CircleDot,
  task_completed: CircleCheck,
  tool_started: Cog,
  tool_finished: Cog
};

function eventLabel(e: Record<string, unknown>): string {
  switch (e.type) {
    case "flow_started":
      return `Flow ${e.flow_name ?? ""} started`;
    case "flow_finished":
      return `Flow ${e.flow_name ?? ""} finished`;
    case "method_started":
      return `${e.flow_name ?? ""} -> ${e.method ?? ""}`;
    case "method_finished":
      return `${e.flow_name ?? ""} -> ${e.method ?? ""} done`;
    case "crew_started":
      return `Crew ${e.crew_name ?? ""} started`;
    case "crew_completed":
      return `Crew ${e.crew_name ?? ""} completed`;
    case "task_started":
      return `Task ${e.task_name ?? ""} (${e.agent_role ?? "?"})`;
    case "task_completed":
      return `Task ${e.task_name ?? ""} done`;
    case "tool_started":
      return `Tool ${e.tool ?? ""}`;
    case "tool_finished":
      return `Tool ${e.tool ?? ""} done`;
    case "llm_chunk":
      return String(e.content ?? "").slice(0, 200);
    case "phase":
      return `Phase -> ${e.phase ?? ""}`;
    case "revision_proposed":
      return `Revision proposed: ${e.change_summary ?? ""}`;
    case "revision_applied":
      return `Revision applied`;
    case "revision_dropped":
      return `Revision dropped`;
    case "revision_restored":
      return `Revision restored`;
    case "user_edit_applied":
      return `Manual edit applied: ${e.change_summary ?? ""}`;
    case "critique_updated":
      return `Critique updated (${e.issue_count ?? 0} issues)`;
    case "review":
      return `Review: ${e.action ?? ""} -> phase ${e.phase ?? ""}`;
    default:
      return String(e.type ?? "event");
  }
}

export function AIThinkingStream() {
  const events = useEventsStore((s) => s.events);
  const recent = React.useMemo(() => events.slice(-30).reverse(), [events]);

  // Aggregate llm_chunks into a single growing string for nicer UX.
  const lastChunkText = React.useMemo(() => {
    let text = "";
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === "llm_chunk") {
        text = e.content + text;
        if (text.length > 600) break;
      }
    }
    return text.slice(-600);
  }, [events]);

  return (
    <div className="flex w-full flex-col gap-2">
      {lastChunkText ? (
        <div className="rounded-md border border-border/60 bg-bg/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">
          {lastChunkText}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border/60 px-3 py-3 text-[11px] text-muted">
          Waiting for AI activity…
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        <AnimatePresence initial={false}>
          {recent.map((e, i) => {
            const Icon = ICON_FOR[(e as { type: string }).type] || CircleDot;
            return (
              <motion.div
                key={`${i}-${(e as { type: string }).type}`}
                layout
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="flex items-start gap-2 rounded-md px-2 py-1 text-xs hover:bg-surfaceAlt/40"
              >
                <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-accent" />
                <div className="truncate text-text">{eventLabel(e)}</div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
