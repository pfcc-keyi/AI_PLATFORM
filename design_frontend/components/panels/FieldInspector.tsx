"use client";

import * as React from "react";
import {
  ArrowRight,
  Lightbulb,
  MessageSquarePlus,
  Sparkles,
  Workflow
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useDesignStore } from "@/store/designStore";
import { HandlerCard } from "./HandlersPanel";
import type {
  ActionDesign,
  FullDesign,
  HandlerSketch,
  SchemaDesign
} from "@/lib/types";

interface FieldInspectorProps {
  designId: string;
  table: SchemaDesign;
  fieldName: string;
  initialState?: string;
  design?: FullDesign | undefined;
}

/**
 * Field inspector — completely reworked per UX feedback.
 *
 * Previous behaviour: a state dropdown + a "Suggest handlers" button that
 * fired an LLM call on demand. The user found this confusing — they expect
 * the inspector to *immediately* show "what touches this field, in which
 * state". The new design does exactly that:
 *
 *  - For every state in this table, render a small section listing:
 *      • declared `actions` whose transition leaves that state, and
 *      • already-generated `handler_sketches` whose `trigger_state` matches
 *        and whose `fields_touched` contains this field.
 *  - No button to fire an extra LLM call (that lives in the Handlers tab
 *    now). Users still get an inline CTA to "Refine this in chat" so they
 *    can ask for changes.
 */
export function FieldInspector({
  table,
  fieldName,
  initialState,
  design
}: FieldInspectorProps) {
  const setPendingChatPrompt = useDesignStore((s) => s.setPendingChatPrompt);
  const column = table.columns.find((c) => c.name === fieldName);

  const orderedStates = React.useMemo(() => {
    const set = new Set<string>();
    if (initialState) set.add(initialState);
    table.states.forEach((s) => set.add(s));
    table.transitions.forEach((t) => {
      set.add(t.from_state);
      set.add(t.to_state);
    });
    return Array.from(set).filter((s) => s !== "deleted");
  }, [table.states, table.transitions, initialState]);

  const handlerSketches = design?.handler_sketches ?? [];
  const fieldQualifiedName = `${table.table_name}.${fieldName}`;

  function actionsLeavingState(state: string): ActionDesign[] {
    return table.actions.filter((a) => a.transition?.from_state === state);
  }

  function handlersOnState(state: string): HandlerSketch[] {
    return handlerSketches.filter((h) => {
      if (h.trigger_state && h.trigger_state !== state) return false;
      // Match by qualified field name (`table.field`) or bare field name —
      // the LLM tends to emit one or the other depending on context.
      const touches = h.fields_touched ?? [];
      return (
        touches.includes(fieldName) ||
        touches.includes(fieldQualifiedName) ||
        // Also count handlers that don't list fields_touched at all if their
        // tables_used includes this table — better to be inclusive than
        // hide a relevant handler.
        (touches.length === 0 && (h.tables_used ?? []).includes(table.table_name))
      );
    });
  }

  function discussInChat(prompt: string) {
    setPendingChatPrompt(prompt);
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
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
          <Lightbulb className="h-3 w-3 text-accent" />
          What touches this field?
        </div>
        <p className="text-[11px] leading-relaxed text-text/85">
          For each state below: the AI-declared <em>actions</em> that fire when
          the row leaves that state, and the suggested <em>handlers</em> that
          would touch this field at that moment. To ask for more, head to the{" "}
          <span className="text-accent">Handlers tab</span>.
        </p>
      </div>

      {/* Per-state breakdown */}
      <div className="flex flex-col gap-3">
        {orderedStates.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 px-3 py-2 text-xs text-muted">
            This table has no states declared.
          </div>
        ) : (
          orderedStates.map((state) => {
            const actions = actionsLeavingState(state);
            const handlers = handlersOnState(state);
            const hasContent = actions.length > 0 || handlers.length > 0;
            return (
              <StateBlock
                key={state}
                state={state}
                actions={actions}
                handlers={handlers}
                isInitial={state === initialState}
                onDiscussInChat={discussInChat}
                hasContent={hasContent}
                fieldQualifiedName={fieldQualifiedName}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function StateBlock({
  state,
  actions,
  handlers,
  isInitial,
  hasContent,
  fieldQualifiedName,
  onDiscussInChat
}: {
  state: string;
  actions: ActionDesign[];
  handlers: HandlerSketch[];
  isInitial: boolean;
  hasContent: boolean;
  fieldQualifiedName: string;
  onDiscussInChat: (prompt: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Workflow className="h-3.5 w-3.5 text-accent" />
          <code className="rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] text-accent">
            {state}
          </code>
          {isInitial ? (
            <span className="rounded-sm bg-accent/15 px-1 py-0.5 text-[9px] uppercase tracking-wider text-accent">
              initial
            </span>
          ) : null}
        </div>
        <span className="text-[10px] text-muted">
          {actions.length} action{actions.length === 1 ? "" : "s"} ·{" "}
          {handlers.length} handler{handlers.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Declared actions leaving this state */}
      {actions.length > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">
            Actions leaving this state
          </div>
          <div className="flex flex-col gap-1">
            {actions.map((a) => (
              <div
                key={a.name}
                className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-surfaceAlt/40 px-2 py-1 text-[11px]"
              >
                <code className="font-mono text-text">{a.name}</code>
                <Badge variant="muted">{a.function_type}</Badge>
                <span className="text-[10px] text-muted">
                  {a.transition.from_state}{" "}
                  <ArrowRight className="inline h-3 w-3 text-text" />{" "}
                  {a.transition.to_state}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Handler sketches relevant to this state + field */}
      {handlers.length > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">
            Suggested handlers
          </div>
          <div className="flex flex-col gap-1">
            {handlers.map((h, i) => (
              <HandlerCard
                key={`${h.handler_name}-${i}`}
                handler={h}
                embedded
                onAskAI={onDiscussInChat}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Empty state for this state */}
      {!hasContent ? (
        <div className="rounded-md border border-dashed border-border/60 px-2 py-1.5 text-[11px] text-muted">
          No actions or handler suggestions touch this field while in{" "}
          <code className="text-text/80">{state}</code>.
          <button
            onClick={() =>
              onDiscussInChat(
                `Propose a handler that touches ${fieldQualifiedName} when the row leaves state "${state}".`
              )
            }
            className="ml-2 inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/20"
          >
            <Sparkles className="h-3 w-3" />
            Suggest one
          </button>
        </div>
      ) : (
        <button
          onClick={() =>
            onDiscussInChat(
              `Refine the handlers/actions touching ${fieldQualifiedName} in state "${state}": `
            )
          }
          className="inline-flex w-fit items-center gap-1 self-end rounded-full border border-border/60 bg-bg/40 px-2 py-0.5 text-[10px] text-muted hover:bg-surfaceAlt hover:text-text"
        >
          <MessageSquarePlus className="h-3 w-3" />
          Refine in chat
        </button>
      )}
    </div>
  );
}

