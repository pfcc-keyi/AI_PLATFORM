"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import type { SchemaDesign } from "@/lib/types";
import { StateTransitionPanel } from "./StateTransitionPanel";

interface TableInspectorProps {
  table: SchemaDesign;
  onSelectField: (fieldName: string) => void;
}

export function TableInspector({ table, onSelectField }: TableInspectorProps) {
  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <code className="text-lg font-semibold text-text">
            {table.table_name}
          </code>
          <Badge variant={table.table_category === "lookup" ? "accent" : "muted"}>
            {table.table_category}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {table.states.map((s) => (
            <Badge key={s} variant="default">{s}</Badge>
          ))}
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <div className="text-xs font-medium uppercase tracking-wider text-muted">
          State transitions
        </div>
        <StateTransitionPanel table={table} />
      </section>

      <section className="flex flex-col gap-2">
        <div className="text-xs font-medium uppercase tracking-wider text-muted">
          Columns
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-surfaceAlt/60 text-muted">
              <tr>
                <th className="px-2 py-1 text-left">Field</th>
                <th className="px-2 py-1 text-left">Type</th>
                <th className="px-2 py-1 text-left">Flags</th>
              </tr>
            </thead>
            <tbody>
              {table.columns.map((c) => (
                <tr
                  key={c.name}
                  className="cursor-pointer border-t border-border hover:bg-surfaceAlt/40"
                  onClick={() => onSelectField(c.name)}
                  title="Click to ask for handler suggestions"
                >
                  <td className="px-2 py-1 font-mono">{c.name}</td>
                  <td className="px-2 py-1 text-muted">{c.pg_type}</td>
                  <td className="px-2 py-1">
                    {c.name === table.pk_field ? (
                      <Badge variant="accent">PK</Badge>
                    ) : null}{" "}
                    {c.nullable === false ? (
                      <Badge variant="muted">NOT NULL</Badge>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {table.fk_definitions.length ? (
        <section className="flex flex-col gap-2">
          <div className="text-xs font-medium uppercase tracking-wider text-muted">
            Foreign keys
          </div>
          <div className="flex flex-col gap-1 text-xs">
            {table.fk_definitions.map((fk) => (
              <div key={fk.field} className="flex flex-wrap items-center gap-1">
                <code>{fk.field}</code>
                <span className="text-muted">→</span>
                <code>{fk.references_table}.{fk.references_field}</code>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <div className="text-xs font-medium uppercase tracking-wider text-muted">
          Actions
        </div>
        <div className="flex flex-col gap-1 text-xs">
          {table.actions.map((a) => (
            <div key={a.name} className="flex items-center gap-2">
              <code>{a.name}</code>
              <Badge variant="muted">{a.function_type}</Badge>
              <span className="text-muted">
                {a.transition.from_state} → {a.transition.to_state}
              </span>
            </div>
          ))}
          {table.actions.length === 0 ? (
            <div className="text-muted">No actions declared.</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
