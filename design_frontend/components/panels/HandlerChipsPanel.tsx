"use client";

import { motion } from "framer-motion";
import {
  Cog,
  Workflow,
  Loader2,
  ListOrdered,
  Database,
  AlertTriangle,
  ArrowRight,
  Sparkles
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import type { HandlerSketch } from "@/lib/types";

interface HandlerChipsPanelProps {
  handlers: HandlerSketch[];
  loading?: boolean;
  emptyMessage?: string;
}

/**
 * Renders handler suggestions with a clear "what / when / how / why"
 * structure. Each handler card has:
 *   - Header: name + mode + transition (when this fires)
 *   - Description (what it does)
 *   - Steps (numbered, with table.action and raw-query hints)
 *   - Touched fields + tables (tags)
 *   - Reasoning (why the AI suggested this)
 *   - Error handling + return (collapsible "details" so cards stay short)
 */
export function HandlerChipsPanel({
  handlers,
  loading = false,
  emptyMessage = "No handler suggestions yet."
}: HandlerChipsPanelProps) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-bg/30 px-3 py-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin text-accent" />
        Asking the AI for handler suggestions…
      </div>
    );
  }

  if (!handlers.length) {
    return (
      <div className="rounded-md border border-dashed border-border/60 bg-bg/30 px-3 py-3 text-xs text-muted">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {handlers.map((h, i) => (
        <HandlerCard key={`${h.handler_name}-${i}`} handler={h} index={i} />
      ))}
    </div>
  );
}

function HandlerCard({
  handler: h,
  index
}: {
  handler: HandlerSketch;
  index: number;
}) {
  const transitionLabel = h.trigger_state
    ? `${h.trigger_state} → ${h.target_state || "?"}`
    : "";
  const steps = h.steps ?? [];
  const fieldsTouched = h.fields_touched ?? [];
  const tablesUsed = h.tables_used ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.04 }}
      className="overflow-hidden rounded-xl border border-border bg-surfaceAlt/40 shadow-sm"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border bg-surface/60 px-3 py-2.5">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Cog className="h-4 w-4 flex-shrink-0 text-accent" />
            <code className="truncate font-mono text-text">{h.handler_name}</code>
          </div>
          {transitionLabel ? (
            <div className="flex items-center gap-1.5 text-[11px] text-muted">
              <Workflow className="h-3 w-3 text-accentAlt" />
              <span>Fires when</span>
              <span className="rounded-md border border-accentAlt/40 bg-accentAlt/10 px-1.5 py-0.5 font-mono text-[10px] text-accentAlt">
                {transitionLabel}
              </span>
            </div>
          ) : null}
        </div>
        <Badge variant={h.mode === "async" ? "warning" : "muted"}>
          {h.mode || "sync"}
        </Badge>
      </div>

      <div className="flex flex-col gap-3 px-3 py-3">
        {/* What */}
        {h.description ? (
          <Section icon={<Sparkles className="h-3 w-3 text-accent" />} label="What">
            <p className="text-xs leading-relaxed text-text">{h.description}</p>
          </Section>
        ) : null}

        {/* Why — reasoning gets dedicated emphasis. */}
        {h.reasoning ? (
          <Section
            icon={<AlertTriangle className="h-3 w-3 text-warning" />}
            label="Why"
            tone="accent"
          >
            <p className="text-xs leading-relaxed text-text/90">{h.reasoning}</p>
          </Section>
        ) : null}

        {/* How — numbered steps */}
        {steps.length > 0 ? (
          <Section
            icon={<ListOrdered className="h-3 w-3 text-accentAlt" />}
            label={`How · ${steps.length} step${steps.length === 1 ? "" : "s"}`}
          >
            <ol className="flex flex-col gap-1.5">
              {steps.map((s) => (
                <li
                  key={s.step_number}
                  className="flex gap-2 rounded-md border border-border/50 bg-bg/40 px-2 py-1.5 text-[11px]"
                >
                  <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-accent/20 font-mono text-[9px] text-accent">
                    {s.step_number}
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-text">{s.description}</span>
                    {s.is_raw_query ? (
                      <code className="break-words font-mono text-[10px] text-accentAlt">
                        SQL: {s.raw_query_description || "raw SQL step"}
                      </code>
                    ) : s.table_name || s.action_name ? (
                      <code className="break-words font-mono text-[10px] text-muted">
                        {s.table_name ? `ctx.tables.${s.table_name}` : ""}
                        {s.action_name ? `.${s.action_name}(...)` : ""}
                        {s.input_mapping ? ` with ${s.input_mapping}` : ""}
                        {s.output_key ? ` → ${s.output_key}` : ""}
                      </code>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        ) : null}

        {/* Touches — fields + tables */}
        {(fieldsTouched.length > 0 || tablesUsed.length > 0) ? (
          <Section
            icon={<Database className="h-3 w-3 text-success" />}
            label="Touches"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              {tablesUsed.map((t) => (
                <Badge key={`t-${t}`} variant="muted">
                  <Database className="h-3 w-3" />
                  {t}
                </Badge>
              ))}
              {fieldsTouched.map((f) => (
                <Badge key={`f-${f}`} variant="default">
                  {f}
                </Badge>
              ))}
            </div>
          </Section>
        ) : null}

        {/* Error + return details */}
        {h.error_handling || h.return_description ? (
          <details className="rounded-md border border-border/40 bg-bg/30 px-2 py-1.5 text-[11px] text-muted">
            <summary className="cursor-pointer select-none text-text/80">
              More details
            </summary>
            <div className="mt-1.5 flex flex-col gap-1.5 pl-1">
              {h.return_description ? (
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-muted">
                    Returns
                  </span>
                  <div className="flex items-start gap-1 text-text/90">
                    <ArrowRight className="mt-0.5 h-3 w-3 text-muted" />
                    <span>{h.return_description}</span>
                  </div>
                </div>
              ) : null}
              {h.error_handling ? (
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-muted">
                    On error
                  </span>
                  <div className="text-text/90">{h.error_handling}</div>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </motion.div>
  );
}

function Section({
  icon,
  label,
  tone = "default",
  children
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "default" | "accent";
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={
          tone === "accent"
            ? "flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent"
            : "flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted"
        }
      >
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}
