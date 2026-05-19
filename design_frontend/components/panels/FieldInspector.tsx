"use client";

import * as React from "react";
import { Sparkles, Lightbulb, RefreshCw } from "lucide-react";
import { useDesignStore } from "@/store/designStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HandlerChipsPanel } from "./HandlerChipsPanel";
import { suggestHandlers } from "@/lib/api";
import type { HandlerSketch, SchemaDesign } from "@/lib/types";

interface FieldInspectorProps {
  designId: string;
  table: SchemaDesign;
  fieldName: string;
  initialState?: string;
}

export function FieldInspector({
  designId,
  table,
  fieldName,
  initialState
}: FieldInspectorProps) {
  const column = table.columns.find((c) => c.name === fieldName);
  const [state, setState] = React.useState<string>(
    initialState || table.states[0] || "active"
  );
  const [handlers, setHandlers] = React.useState<HandlerSketch[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hasAsked, setHasAsked] = React.useState(false);

  // Show only handlers whose trigger or target involves the picked state,
  // when available. Helps the user understand "in state X, who touches me?".
  const relevantHandlers = React.useMemo(() => {
    if (!handlers.length) return handlers;
    return handlers.filter(
      (h) =>
        !h.trigger_state ||
        h.trigger_state === state ||
        h.target_state === state
    );
  }, [handlers, state]);

  // Pre-warm any existing actions on this transition so users see why the AI
  // might be quiet — e.g. there are 0 transitions out of `state`, so nothing
  // would fire.
  const outgoingTransitions = React.useMemo(
    () => table.transitions.filter((t) => t.from_state === state),
    [table.transitions, state]
  );

  async function fetchSuggestions() {
    setLoading(true);
    setError(null);
    try {
      const resp = await suggestHandlers(designId, {
        table: table.table_name,
        field: fieldName,
        state
      });
      setHandlers(resp.handlers || []);
      setHasAsked(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Field header */}
      <div className="flex flex-col gap-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Field
        </div>
        <div className="flex items-center gap-2 text-base font-semibold">
          <code className="font-mono">
            {table.table_name}.<span className="text-accent">{fieldName}</span>
          </code>
        </div>
        {column ? (
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <Badge variant="muted">{column.pg_type}</Badge>
            {column.nullable === false ? (
              <Badge variant="muted">NOT NULL</Badge>
            ) : null}
            {column.unique ? <Badge variant="muted">UNIQUE</Badge> : null}
            {fieldName === table.pk_field ? (
              <Badge variant="accent">PK</Badge>
            ) : null}
          </div>
        ) : (
          <div className="text-xs text-danger">
            Field not found in current design.
          </div>
        )}
      </div>

      {/* Explanation card */}
      <div className="rounded-lg border border-border bg-surfaceAlt/40 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
          <Lightbulb className="h-3 w-3 text-accent" />
          What "Suggest handlers" does
        </div>
        <p className="text-xs leading-relaxed text-text/85">
          The AI looks at this field, the chosen state, and the platform's
          handler examples, then proposes 1–3 handlers that would normally
          touch this field while the row is in that state — with what they
          do, how (step-by-step), and why.
        </p>
      </div>

      {/* State selector + ask */}
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg/30 p-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
            In state
          </span>
          <select
            className="flex-1 rounded-md border border-border bg-bg/60 px-2 py-1 text-xs"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            {(table.states || []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between gap-2 text-[10px] text-muted">
          <span>
            {outgoingTransitions.length === 0
              ? "No transitions leave this state — the AI may struggle to find a handler."
              : `${outgoingTransitions.length} transition${outgoingTransitions.length === 1 ? "" : "s"} leave this state.`}
          </span>
          <Button size="sm" onClick={fetchSuggestions} disabled={loading}>
            {loading ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {hasAsked ? "Re-ask" : "Suggest handlers"}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}

      {/* Result list */}
      <div className="flex flex-col gap-2">
        {hasAsked && relevantHandlers.length !== handlers.length ? (
          <div className="text-[11px] text-muted">
            Showing {relevantHandlers.length} of {handlers.length} handlers
            relevant to state <code className="text-text">{state}</code>.
          </div>
        ) : null}
        <HandlerChipsPanel
          handlers={relevantHandlers}
          loading={loading}
          emptyMessage={
            hasAsked
              ? "AI returned no handlers for this field/state combo."
              : "Pick a state above and click Suggest handlers."
          }
        />
      </div>
    </div>
  );
}
