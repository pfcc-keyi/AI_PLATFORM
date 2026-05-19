"use client";

import * as React from "react";
import {
  Crosshair,
  Database,
  KeyRound,
  Link2,
  Maximize2,
  Workflow,
  X
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SchemaDesign } from "@/lib/types";
import { StateTransitionPanel } from "./StateTransitionPanel";
import { cn } from "@/lib/utils";

interface TableInspectorProps {
  table: SchemaDesign;
  onSelectField: (fieldName: string) => void;
  /** Re-frame the 3D camera on this table (parent bumps focusToken). */
  onLocate?: () => void;
}

export function TableInspector({
  table,
  onSelectField,
  onLocate
}: TableInspectorProps) {
  const [fsOpen, setFsOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <code className="truncate text-lg font-semibold text-text">
              {table.table_name}
            </code>
            <Badge variant={table.table_category === "lookup" ? "accent" : "muted"}>
              {table.table_category}
            </Badge>
          </div>
          {onLocate ? (
            <button
              onClick={onLocate}
              title="Locate in 3D scene"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted hover:bg-surfaceAlt hover:text-accent"
            >
              <Crosshair className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-[10px] uppercase tracking-wider text-muted">
            States
          </span>
          {table.states.length ? (
            table.states.map((s) => (
              <Badge key={s} variant="default">
                {s}
              </Badge>
            ))
          ) : (
            <span className="text-[11px] text-muted">none</span>
          )}
        </div>
      </div>

      {/* State machine */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
            <Workflow className="h-3 w-3 text-accent" />
            State transitions
          </div>
          <button
            onClick={() => setFsOpen(true)}
            title="Expand"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-surfaceAlt hover:text-text"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
        </div>
        <StateTransitionPanel table={table} />
        <div className="text-[10px] text-muted">
          {table.transitions.length} transition{table.transitions.length === 1 ? "" : "s"} ·
          {" "}drag nodes to reposition · scroll-to-zoom disabled
        </div>
      </section>

      {/* Columns */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
          <Database className="h-3 w-3 text-accentAlt" />
          Columns · {table.columns.length}
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 bg-surfaceAlt/60 px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted">
            <span>Field</span>
            <span className="text-right">Type</span>
            <span className="text-right">Flags</span>
          </div>
          {table.columns.map((c) => {
            const isPk = c.name === table.pk_field;
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => onSelectField(c.name)}
                aria-label={`Column ${c.name} – click for handler suggestions`}
                data-testid={`column-row-${c.name}`}
                className={cn(
                  "grid w-full grid-cols-[1fr_auto_auto] gap-x-2 border-t border-border/70 px-2 py-1.5 text-left text-xs hover:bg-surfaceAlt/40 focus-visible:bg-surfaceAlt/60 focus-visible:outline-none",
                  isPk && "bg-accent/5"
                )}
              >
                <span className="truncate font-mono text-text">{c.name}</span>
                <span className="text-right text-muted">{c.pg_type}</span>
                <span className="flex flex-wrap items-center justify-end gap-1">
                  {isPk ? (
                    <Badge variant="accent">
                      <KeyRound className="h-3 w-3" />
                      PK
                    </Badge>
                  ) : null}
                  {c.nullable === false ? (
                    <Badge variant="muted">NOT NULL</Badge>
                  ) : null}
                  {c.unique ? <Badge variant="muted">UNIQUE</Badge> : null}
                </span>
              </button>
            );
          })}
        </div>
        <div className="text-[10px] text-muted">
          Tip: click any field row to ask the AI for handler suggestions.
        </div>
      </section>

      {/* Foreign keys */}
      {table.fk_definitions.length ? (
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
            <Link2 className="h-3 w-3 text-success" />
            Foreign keys · {table.fk_definitions.length}
          </div>
          <div className="flex flex-col gap-1.5 text-xs">
            {table.fk_definitions.map((fk) => (
              <div
                key={`${fk.field}-${fk.references_table}.${fk.references_field}`}
                className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/50 bg-bg/30 px-2 py-1"
              >
                <code className="font-mono">{fk.field}</code>
                <span className="text-muted">→</span>
                <code className="font-mono text-accent">
                  {fk.references_table}.{fk.references_field}
                </code>
                {fk.on_delete ? (
                  <Badge variant="muted">on delete {fk.on_delete}</Badge>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Actions */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
          <Workflow className="h-3 w-3 text-warning" />
          Actions · {table.actions.length}
        </div>
        <div className="flex flex-col gap-1.5 text-xs">
          {table.actions.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-2 py-2 text-muted">
              No actions declared.
            </div>
          ) : (
            table.actions.map((a) => (
              <div
                key={a.name}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 bg-bg/30 px-2 py-1"
              >
                <code className="font-mono">{a.name}</code>
                <Badge variant="muted">{a.function_type}</Badge>
                <span className="text-muted">
                  {a.transition.from_state}{" "}
                  <span className="text-text">→</span> {a.transition.to_state}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Fullscreen state machine */}
      {fsOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-bg/70 backdrop-blur-sm"
          onClick={() => setFsOpen(false)}
        >
          <div
            className="relative h-[80vh] w-[min(1080px,calc(100vw-4rem))] rounded-2xl border border-border bg-surface/95 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Workflow className="h-4 w-4 text-accent" />
                <span className="font-mono text-sm font-semibold">
                  {table.table_name}
                </span>
                <Badge variant="muted">state machine</Badge>
              </div>
              <button
                onClick={() => setFsOpen(false)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surfaceAlt hover:text-text"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="h-[calc(80vh-4.5rem)]">
              <StateTransitionPanel table={table} height="100%" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
