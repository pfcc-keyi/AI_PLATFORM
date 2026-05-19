"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Cog,
  Database,
  Loader2,
  MessageSquarePlus,
  Sparkles,
  Workflow
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useDesignStore } from "@/store/designStore";
import { suggestHandlers } from "@/lib/api";
import type { FullDesign, HandlerSketch, SchemaDesign } from "@/lib/types";
import { cn } from "@/lib/utils";

interface HandlersPanelProps {
  design: FullDesign | undefined;
  designId: string;
  onPickTable?: (tableName: string) => void;
}

/**
 * "Handlers" tab in the right rail.
 *
 * Goal — fix the previous confusion where handler suggestions were buried in
 * the field inspector and required a click on the "Suggest handlers" button.
 *
 *   - Lists every `HandlerSketch` the AI has produced so far, grouped by the
 *     primary table it touches.
 *   - Each handler is a small card (compact by default) with an expandable
 *     details section showing the full steps, fields, etc.
 *   - "Ask AI for more handlers" CTA at the bottom that triggers the
 *     suggest-handlers endpoint scoped to the user's choice of table + state.
 */
export function HandlersPanel({
  design,
  designId,
  onPickTable
}: HandlersPanelProps) {
  const setPendingChatPrompt = useDesignStore((s) => s.setPendingChatPrompt);

  const handlers = design?.handler_sketches ?? [];
  const schemaDesigns = design?.schema_designs ?? [];

  // Group handlers by their "primary" table: prefer the first entry in
  // tables_used; fall back to the table_name of the first step that has one.
  const groups = React.useMemo(() => {
    const map = new Map<string, HandlerSketch[]>();
    for (const h of handlers) {
      const primary =
        h.tables_used?.[0] ||
        h.steps?.find((s) => s.table_name)?.table_name ||
        "unassigned";
      if (!map.has(primary)) map.set(primary, []);
      map.get(primary)!.push(h);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [handlers]);

  return (
    <div className="flex flex-col gap-3">
      {/* Header card */}
      <div className="rounded-lg border border-border bg-surfaceAlt/30 p-3">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
          <Cog className="h-3 w-3 text-accent" />
          Suggested handlers
        </div>
        <p className="text-[11px] leading-relaxed text-text/85">
          Per-field business logic the AI proposes for this design. Each handler
          is a sketch — what it does, why, the steps, and which fields it
          touches — shaped so the existing{" "}
          <code className="font-mono text-[10px] text-accent">ConfigFlow</code>{" "}
          can codegen real handlers from it later.
        </p>
        <p className="mt-1.5 text-[10px] text-muted">
          {handlers.length} handler{handlers.length === 1 ? "" : "s"} ·{" "}
          {groups.length} table{groups.length === 1 ? "" : "s"} involved
        </p>
      </div>

      {handlers.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 bg-bg/30 px-3 py-3 text-xs text-muted">
          No handler suggestions yet. The AI will fill these in during the{" "}
          <span className="text-text/90">designing</span> step, or you can ask
          for more below.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map(([tableName, list]) => (
            <TableHandlerGroup
              key={tableName}
              tableName={tableName}
              handlers={list}
              onPickTable={onPickTable}
              onAskAI={(prompt) => setPendingChatPrompt(prompt)}
            />
          ))}
        </div>
      )}

      <SuggestMoreCTA
        designId={designId}
        schemaDesigns={schemaDesigns}
        onAskAI={(prompt) => setPendingChatPrompt(prompt)}
      />
    </div>
  );
}

/* ---------- per-table group ---------- */

function TableHandlerGroup({
  tableName,
  handlers,
  onPickTable,
  onAskAI
}: {
  tableName: string;
  handlers: HandlerSketch[];
  onPickTable?: (tableName: string) => void;
  onAskAI: (prompt: string) => void;
}) {
  const [open, setOpen] = React.useState(true);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg/30">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 border-b border-border/70 bg-surface/60 px-3 py-1.5 text-left hover:bg-surfaceAlt/40"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {open ? (
            <ChevronDown className="h-3 w-3 text-muted" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted" />
          )}
          <Database className="h-3 w-3 text-accent" />
          <code className="truncate font-mono text-xs text-text">{tableName}</code>
          <span className="text-[10px] text-muted">· {handlers.length}</span>
        </div>
        {onPickTable && tableName !== "unassigned" ? (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onPickTable(tableName);
            }}
            role="button"
            tabIndex={0}
            className="rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-muted hover:bg-surfaceAlt hover:text-accent"
            title="Open this table in the inspector"
          >
            open
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="flex flex-col gap-1.5 p-2">
          {handlers.map((h, i) => (
            <HandlerCard
              key={`${h.handler_name}-${i}`}
              handler={h}
              onAskAI={onAskAI}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- single compact handler card ---------- */

interface HandlerCardProps {
  handler: HandlerSketch;
  /** When true, the card renders without the wrapping group container —
   *  useful when embedded in the TableInspector. */
  embedded?: boolean;
  onAskAI?: (prompt: string) => void;
}

export function HandlerCard({
  handler: h,
  embedded = false,
  onAskAI
}: HandlerCardProps) {
  const [open, setOpen] = React.useState(false);
  const transitionLabel = h.trigger_state
    ? `${h.trigger_state} → ${h.target_state || "?"}`
    : "";
  const steps = h.steps ?? [];
  const fieldsTouched = h.fields_touched ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={cn(
        "overflow-hidden rounded-md border border-border/70 bg-surface/60",
        embedded && "bg-bg/30"
      )}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start justify-between gap-2 px-2.5 py-2 text-left hover:bg-surfaceAlt/40"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            {open ? (
              <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted" />
            ) : (
              <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted" />
            )}
            <Cog className="h-3 w-3 flex-shrink-0 text-accent" />
            <code className="truncate font-mono text-xs font-semibold text-text">
              {h.handler_name}
            </code>
            <Badge variant={h.mode === "async" ? "warning" : "muted"}>
              {h.mode || "sync"}
            </Badge>
          </div>
          {h.description ? (
            <div className="ml-[1.125rem] line-clamp-2 text-[11px] text-muted">
              {h.description}
            </div>
          ) : null}
          {transitionLabel ? (
            <div className="ml-[1.125rem] flex items-center gap-1 text-[10px]">
              <Workflow className="h-3 w-3 text-accentAlt" />
              <span className="text-muted">Fires when</span>
              <span className="rounded-sm border border-accentAlt/40 bg-accentAlt/10 px-1 py-px font-mono text-[10px] text-accentAlt">
                {transitionLabel}
              </span>
            </div>
          ) : null}
        </div>
      </button>

      {open ? (
        <div className="flex flex-col gap-2 border-t border-border/60 bg-bg/40 px-3 py-2 text-[11px]">
          {h.reasoning ? (
            <Section icon="!" label="Why">
              <p className="text-text/90">{h.reasoning}</p>
            </Section>
          ) : null}

          {steps.length > 0 ? (
            <Section icon="1" label={`How · ${steps.length} step${steps.length === 1 ? "" : "s"}`}>
              <ol className="flex flex-col gap-1">
                {steps.map((s) => (
                  <li
                    key={s.step_number}
                    className="flex gap-1.5 rounded-sm border border-border/50 bg-bg/40 px-1.5 py-1"
                  >
                    <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full bg-accent/20 font-mono text-[8px] text-accent">
                      {s.step_number}
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-text">{s.description}</span>
                      {s.is_raw_query ? (
                        <code className="break-words font-mono text-[9px] text-accentAlt">
                          SQL: {s.raw_query_description || "raw SQL step"}
                        </code>
                      ) : s.table_name || s.action_name ? (
                        <code className="break-words font-mono text-[9px] text-muted">
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

          {fieldsTouched.length > 0 ? (
            <Section icon="·" label="Fields touched">
              <div className="flex flex-wrap gap-1">
                {fieldsTouched.map((f) => (
                  <Badge key={f} variant="default">
                    {f}
                  </Badge>
                ))}
              </div>
            </Section>
          ) : null}

          {h.error_handling || h.return_description ? (
            <details className="rounded-sm border border-border/40 px-1.5 py-1 text-[10px] text-muted">
              <summary className="cursor-pointer select-none text-text/80">
                More
              </summary>
              <div className="mt-1 flex flex-col gap-1 pl-1">
                {h.return_description ? (
                  <div>
                    <span className="text-[9px] uppercase tracking-wider text-muted">
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
                    <span className="text-[9px] uppercase tracking-wider text-muted">
                      On error
                    </span>
                    <div className="text-text/90">{h.error_handling}</div>
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}

          {onAskAI ? (
            <button
              onClick={() =>
                onAskAI(
                  `For the suggested handler "${h.handler_name}" (fires ${transitionLabel || "on this state"}), please refine: `
                )
              }
              className="inline-flex w-fit items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/20"
            >
              <MessageSquarePlus className="h-3 w-3" />
              Refine this handler with AI
            </button>
          ) : null}
        </div>
      ) : null}
    </motion.div>
  );
}

function Section({
  icon,
  label,
  children
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">
        <span className="flex h-3 w-3 items-center justify-center rounded-sm bg-bg/60 font-mono text-[8px]">
          {icon}
        </span>
        {label}
      </div>
      {children}
    </div>
  );
}

/* ---------- "ask AI for more handlers" CTA ---------- */

function SuggestMoreCTA({
  designId,
  schemaDesigns,
  onAskAI
}: {
  designId: string;
  schemaDesigns: SchemaDesign[];
  onAskAI: (prompt: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [tableName, setTableName] = React.useState(
    schemaDesigns[0]?.table_name ?? ""
  );
  const [fieldName, setFieldName] = React.useState(
    schemaDesigns[0]?.columns?.[0]?.name ?? ""
  );
  const [stateName, setStateName] = React.useState(
    schemaDesigns[0]?.states?.[0] ?? ""
  );
  const [result, setResult] = React.useState<HandlerSketch[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const currentTable = schemaDesigns.find((t) => t.table_name === tableName);

  React.useEffect(() => {
    if (!currentTable) return;
    if (!currentTable.columns.find((c) => c.name === fieldName)) {
      setFieldName(currentTable.columns[0]?.name ?? "");
    }
    if (!currentTable.states.includes(stateName)) {
      setStateName(currentTable.states[0] ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName]);

  async function ask() {
    if (!currentTable || !fieldName || !stateName) return;
    setBusy(true);
    setError(null);
    setResult([]);
    try {
      const resp = await suggestHandlers(designId, {
        table: tableName,
        field: fieldName,
        state: stateName
      });
      setResult(resp.handlers || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-accent/30 bg-accent/5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-accent/10"
      >
        <div className="flex items-center gap-1.5 text-xs font-semibold text-accent">
          <Sparkles className="h-3.5 w-3.5" />
          Suggest more handlers
        </div>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-accent" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-accent" />
        )}
      </button>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-accent/20 p-3 text-xs">
          <p className="text-[11px] leading-relaxed text-muted">
            Pick a table + field + state. The AI will propose 1–3 handlers that
            would normally touch this field while the row is in that state.
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            <select
              className="rounded-md border border-border bg-bg/60 px-1.5 py-1 text-[11px]"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              disabled={schemaDesigns.length === 0}
            >
              {schemaDesigns.map((t) => (
                <option key={t.table_name} value={t.table_name}>
                  {t.table_name}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-border bg-bg/60 px-1.5 py-1 text-[11px]"
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
              disabled={!currentTable}
            >
              {(currentTable?.columns ?? []).map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-border bg-bg/60 px-1.5 py-1 text-[11px]"
              value={stateName}
              onChange={(e) => setStateName(e.target.value)}
              disabled={!currentTable}
            >
              {(currentTable?.states ?? []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <button
              onClick={ask}
              disabled={busy || !currentTable || !fieldName || !stateName}
              className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/15 px-2.5 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/25 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              Ask AI
            </button>
          </div>

          {error ? (
            <div className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">
              {error}
            </div>
          ) : null}

          {result.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] uppercase tracking-wider text-muted">
                Returned ({result.length})
              </div>
              {result.map((h, i) => (
                <HandlerCard
                  key={`${h.handler_name}-${i}`}
                  handler={h}
                  embedded
                  onAskAI={onAskAI}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
