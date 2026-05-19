"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, Compass, Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useEventsStore } from "@/store/eventsStore";
import { cn } from "@/lib/utils";
import type { DomainAnalysis } from "@/lib/types";
import { ProgressStepper } from "./ProgressStepper";

interface ActivityPanelProps {
  phase: string | undefined;
  domain: DomainAnalysis | undefined;
}

/**
 * The "what is the AI doing right now and what has it figured out so far?"
 * tab. Replaces the old free-form activity stream with a structured view:
 *
 *   1. A phase-by-phase progress stepper at the top so the user always knows
 *      which of the seven design steps is running and what comes next.
 *   2. Domain analysis — moved here from its own tab — to surface the AI's
 *      "what this schema is about" reading as soon as it's available.
 *   3. A compact recent-activity log, collapsed by default, for users who
 *      want to peek under the hood at the raw event stream.
 */
export function ActivityPanel({ phase, domain }: ActivityPanelProps) {
  const isStreaming =
    !!phase &&
    phase !== "ready" &&
    phase !== "rejected" &&
    phase !== "awaiting_clarification" &&
    phase !== "awaiting_review";

  return (
    <div className="flex flex-col gap-3">
      <ProgressStepper phase={phase} active={isStreaming} />
      <DomainCard domain={domain} />
      <RecentActivityLog />
    </div>
  );
}

function DomainCard({ domain }: { domain: DomainAnalysis | undefined }) {
  if (!domain || !domain.domain_guess) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-bg/30 px-3 py-3 text-[11px] text-muted">
        The AI hasn&apos;t finished analyzing the domain yet — it&apos;ll appear
        here once the analyze step completes.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surfaceAlt/30 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
          <Compass className="h-3 w-3 text-accent" />
          Domain analysis
        </div>
        <span
          title="The AI's reading of the upload before any per-table design work runs."
          className="cursor-help text-[10px] text-muted"
        >
          what is this schema?
        </span>
      </div>
      <div className="text-sm">
        <span className="text-muted">Guessed domain:</span>{" "}
        <span className="font-medium text-accent">
          {domain.domain_guess || "unknown"}
        </span>
      </div>
      {domain.sub_domains?.length ? (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] uppercase tracking-wider text-muted">
            Sub-domains
          </div>
          <div className="flex flex-wrap gap-1">
            {domain.sub_domains.map((d) => (
              <Badge key={d} variant="accent">
                {d}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
      {domain.assumptions?.length ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted">
            <Lightbulb className="h-3 w-3 text-accent" />
            Assumptions the AI made
          </div>
          <ul className="ml-4 list-disc text-xs text-text/90">
            {domain.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {domain.reasoning ? (
        <div className="rounded-md border border-border/60 bg-bg/30 p-2 text-xs italic text-muted">
          {domain.reasoning}
        </div>
      ) : null}
    </div>
  );
}

/** Tiny collapsible peek into the raw event stream — most users won't open
 *  this, but it's useful for debugging "is the backend stuck?" moments. */
function RecentActivityLog() {
  const events = useEventsStore((s) => s.events);
  const [open, setOpen] = React.useState(false);
  const recent = React.useMemo(() => events.slice(-12).reverse(), [events]);

  return (
    <div className="rounded-lg border border-border/60 bg-bg/30">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[11px] uppercase tracking-[0.16em] text-muted hover:bg-surfaceAlt/40"
      >
        <span className="flex items-center gap-1.5">
          {open ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          Recent activity ({events.length} events)
        </span>
        <span className="text-[10px] normal-case tracking-normal text-muted/80">
          {open ? "hide" : "show"}
        </span>
      </button>
      {open ? (
        <div className="border-t border-border/60 p-2">
          {recent.length === 0 ? (
            <div className="px-1.5 py-1.5 text-[11px] text-muted">
              No activity yet.
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {recent.map((e, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-sm px-1.5 py-0.5 font-mono text-[10px] text-muted/90"
                  )}
                >
                  <span className="text-text/80">
                    {(e as { type?: string }).type ?? "event"}
                  </span>
                  {"·"}
                  <span className="ml-1">{compactLabel(e)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function compactLabel(e: Record<string, unknown>): string {
  switch (e.type) {
    case "method_started":
    case "method_finished":
      return String(e.method ?? "");
    case "task_started":
    case "task_completed":
      return String(e.task_name ?? e.agent_role ?? "");
    case "crew_started":
    case "crew_completed":
      return String(e.crew_name ?? "");
    case "tool_started":
    case "tool_finished":
      return String(e.tool ?? "");
    case "phase":
      return String(e.phase ?? "");
    case "llm_chunk":
      return String(e.content ?? "").slice(0, 80);
    case "revision_proposed":
      return String(e.change_summary ?? "");
    default:
      return "";
  }
}
