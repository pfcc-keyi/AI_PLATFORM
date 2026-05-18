"use client";

import * as React from "react";
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <div className="text-xs uppercase tracking-wider text-muted">Field</div>
        <div className="flex items-center gap-2 text-base font-semibold">
          <code>{table.table_name}.{fieldName}</code>
        </div>
        {column ? (
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <Badge variant="muted">{column.pg_type}</Badge>
            {column.nullable === false ? (
              <Badge variant="muted">NOT NULL</Badge>
            ) : null}
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

      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted">In state:</span>
        <select
          className="rounded-md border border-border bg-bg/50 px-2 py-1 text-xs"
          value={state}
          onChange={(e) => setState(e.target.value)}
        >
          {(table.states || []).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={fetchSuggestions} disabled={loading}>
          {loading ? "Asking..." : "Suggest handlers"}
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}

      <HandlerChipsPanel
        handlers={handlers}
        loading={loading}
        emptyMessage="No suggestions yet — click 'Suggest handlers'."
      />
    </div>
  );
}
