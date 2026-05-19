"use client";

import * as React from "react";
import {
  Check,
  Clock,
  FileSpreadsheet,
  GitBranch,
  HelpCircle,
  Loader2,
  Sparkles,
  Wrench
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * High-level pipeline the SchemaDesignFlow runs through. Ordered, so we can
 * map any reported `phase` string to a position in the timeline and colour
 * the previous steps as done.
 *
 * Keep in sync with `DesignPhase` in `models/design_models.py`.
 */
const PIPELINE: {
  phase: string;
  label: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    phase: "parsing",
    label: "Parsing upload",
    blurb: "Reading the Excel sheets and extracting tables/fields.",
    icon: FileSpreadsheet
  },
  {
    phase: "analyzing",
    label: "Analyzing domain",
    blurb:
      "Clustering tables, guessing the business domain, drafting clarifying questions.",
    icon: Sparkles
  },
  {
    phase: "awaiting_clarification",
    label: "Awaiting answers",
    blurb: "Waiting for you to answer the clarifying questions.",
    icon: HelpCircle
  },
  {
    phase: "designing",
    label: "Designing schema",
    blurb:
      "For each cluster: drafting columns, state machines, transitions and handler sketches.",
    icon: Wrench
  },
  {
    phase: "synthesizing",
    label: "Synthesizing",
    blurb: "Merging per-cluster designs, computing the 3D layout, building the ERD.",
    icon: GitBranch
  },
  {
    phase: "awaiting_review",
    label: "Awaiting review",
    blurb: "Design + critique are ready — your turn to refine or approve.",
    icon: Clock
  },
  {
    phase: "ready",
    label: "Approved",
    blurb: "Design is ready to hand off to ConfigFlow / handler codegen.",
    icon: Check
  }
];

/** Map any incoming phase string (including legacy/sub-phases) to an index in
 *  `PIPELINE`. Returns -1 if the phase isn't known yet (e.g. flow just started). */
function indexOfPhase(phase: string | undefined): number {
  if (!phase) return -1;
  const direct = PIPELINE.findIndex((p) => p.phase === phase);
  if (direct >= 0) return direct;
  // Some intermediate phases the flow may emit:
  if (phase === "refining") return PIPELINE.findIndex((p) => p.phase === "awaiting_review");
  if (phase === "rejected") return PIPELINE.length - 1;
  return -1;
}

interface ProgressStepperProps {
  phase: string | undefined;
  /** When true (during streaming), the current step animates. */
  active: boolean;
}

/**
 * Compact vertical pipeline showing the seven design-flow phases. The current
 * step pulses, completed steps show a check, future steps are dim.
 *
 * Designed to fix the "activity sidebar just spins forever, I have no idea
 * what step we're on" complaint: every step has a label + one-line blurb so
 * the user can see exactly what the AI is doing and what comes next.
 */
export function ProgressStepper({ phase, active }: ProgressStepperProps) {
  const currentIdx = indexOfPhase(phase);
  const isRejected = phase === "rejected";

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surfaceAlt/30 p-3">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
          <Sparkles className="h-3 w-3 text-accent" />
          AI progress
        </div>
        <div className="text-[10px] text-muted">
          {currentIdx < 0
            ? "starting…"
            : `step ${Math.min(currentIdx + 1, PIPELINE.length)} of ${PIPELINE.length}`}
        </div>
      </div>
      <ol className="flex flex-col gap-1.5">
        {PIPELINE.map((step, i) => {
          const isDone = i < currentIdx || (currentIdx >= 0 && phase === "ready" && i === currentIdx);
          const isCurrent = i === currentIdx && phase !== "ready";
          const isFuture = i > currentIdx;
          const Icon = step.icon;
          return (
            <li
              key={step.phase}
              className={cn(
                "flex items-start gap-2 rounded-md px-1.5 py-1 transition",
                isCurrent && "bg-accent/10",
                isFuture && "opacity-50"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border",
                  isDone &&
                    "border-success/60 bg-success/15 text-success",
                  isCurrent &&
                    "border-accent/70 bg-accent/15 text-accent",
                  !isDone && !isCurrent && "border-border/70 bg-bg/40 text-muted"
                )}
              >
                {isDone ? (
                  <Check className="h-3 w-3" />
                ) : isCurrent && active ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Icon className="h-3 w-3" />
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span
                  className={cn(
                    "text-xs font-medium leading-tight",
                    isCurrent && "text-accent",
                    isDone && "text-text"
                  )}
                >
                  {step.label}
                </span>
                <span className="text-[10px] leading-snug text-muted">
                  {step.blurb}
                </span>
              </div>
            </li>
          );
        })}
        {isRejected ? (
          <li className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">
            Design was rejected. Use the chat to revise or start over.
          </li>
        ) : null}
      </ol>
    </div>
  );
}
