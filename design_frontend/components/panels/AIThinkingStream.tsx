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
import { Card } from "@/components/ui/card";

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
  const phase = useEventsStore((s) => s.phase);
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
    <Card className="flex max-h-[60vh] w-[340px] flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
          <Brain className="h-3.5 w-3.5 text-accent" />
          AI thinking
        </div>
        {phase ? (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">
            {phase}
          </span>
        ) : null}
      </div>
      {lastChunkText ? (
        <div className="border-b border-border bg-bg/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">
          {lastChunkText}
        </div>
      ) : null}
      <div className="flex-1 overflow-y-auto px-2 py-2">
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
    </Card>
  );
}
