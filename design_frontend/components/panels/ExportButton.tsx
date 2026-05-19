"use client";

import * as React from "react";
import { ChevronDown, Download, FileCode, FileJson, FileText } from "lucide-react";
import yaml from "js-yaml";
import type { FullDesign, HandlerSketch, SchemaDesign } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ExportButtonProps {
  design: FullDesign | undefined;
}

/** Build a clean, human-readable export object out of the full design.
 *  Strips internal-only fields (created_at, design_id) and keeps the
 *  artefacts a downstream consumer cares about: domain, tables, handlers. */
function buildExportPayload(design: FullDesign) {
  return {
    domain: {
      guess: design.domain_analysis?.domain_guess || null,
      sub_domains: design.domain_analysis?.sub_domains ?? [],
      assumptions: design.domain_analysis?.assumptions ?? [],
      reasoning: design.domain_analysis?.reasoning || null
    },
    clusters: (design.domain_analysis?.clusters ?? []).map((c) => ({
      cluster_id: c.cluster_id,
      name: c.name,
      tables: c.table_names,
      rationale: c.rationale || null
    })),
    tables: design.schema_designs.map((t) => exportTable(t)),
    handlers: design.handler_sketches.map((h) => exportHandler(h)),
    critique: design.critique
      ? {
          summary: design.critique.summary || null,
          issues: design.critique.issues ?? [],
          open_questions: design.critique.open_questions ?? []
        }
      : null
  };
}

function exportTable(t: SchemaDesign) {
  return {
    table_name: t.table_name,
    table_category: t.table_category,
    pk_field: t.pk_field,
    pk_strategy: t.pk_strategy || null,
    states: t.states,
    transitions: t.transitions,
    columns: t.columns.map((c) => ({
      name: c.name,
      pg_type: c.pg_type,
      nullable: c.nullable !== false,
      unique: c.unique || false,
      identity: c.identity || false,
      check: c.check || null,
      default_expr: c.default_expr || null
    })),
    actions: t.actions,
    foreign_keys: t.fk_definitions,
    table_constraints: t.table_constraints
  };
}

function exportHandler(h: HandlerSketch) {
  return {
    name: h.handler_name,
    mode: h.mode || "sync",
    description: h.description || null,
    reasoning: h.reasoning || null,
    fires_on:
      h.trigger_state && h.target_state
        ? `${h.trigger_state} -> ${h.target_state}`
        : null,
    tables_used: h.tables_used ?? [],
    fields_touched: h.fields_touched ?? [],
    steps: (h.steps ?? []).map((s) => ({
      step: s.step_number,
      description: s.description,
      table: s.table_name || null,
      action: s.action_name || null,
      input: s.input_mapping || null,
      output: s.output_key || null,
      raw_query: s.is_raw_query ? s.raw_query_description || true : false
    })),
    error_handling: h.error_handling || null,
    return_description: h.return_description || null
  };
}

function download(name: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileBase(design: FullDesign): string {
  const domain = (design.domain_analysis?.domain_guess || "design")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${domain || "design"}-${stamp}`;
}

export function ExportButton({ design }: ExportButtonProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const disabled = !design;

  function doExport(format: "yaml" | "json" | "sql") {
    if (!design) return;
    const base = fileBase(design);
    if (format === "yaml") {
      const payload = buildExportPayload(design);
      const text = yaml.dump(payload, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
        sortKeys: false
      });
      download(`${base}.yaml`, "text/yaml", text);
    } else if (format === "json") {
      const payload = buildExportPayload(design);
      download(
        `${base}.json`,
        "application/json",
        JSON.stringify(payload, null, 2)
      );
    } else if (format === "sql") {
      const text = renderSqlDdl(design);
      download(`${base}.sql`, "text/sql", text);
    }
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        title={
          disabled
            ? "Wait for the design to load"
            : "Export the current AI-organized design"
        }
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-full border border-border bg-surface/80 px-2.5 text-xs font-medium tracking-tight backdrop-blur",
          disabled
            ? "cursor-not-allowed text-muted/50"
            : "text-text hover:bg-surfaceAlt"
        )}
      >
        <Download className="h-3.5 w-3.5 text-accent" />
        Export
        <ChevronDown
          className={cn(
            "h-3 w-3 transition",
            open && "rotate-180"
          )}
        />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-surface/95 shadow-glow backdrop-blur">
          <div className="border-b border-border/60 px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-muted">
            Download current design as…
          </div>
          <ExportRow
            icon={<FileCode className="h-3.5 w-3.5 text-accent" />}
            label="YAML"
            sub="Best for hand-reviewing the design"
            onClick={() => doExport("yaml")}
          />
          <ExportRow
            icon={<FileJson className="h-3.5 w-3.5 text-accent" />}
            label="JSON"
            sub="Machine-readable, identical structure"
            onClick={() => doExport("json")}
          />
          <ExportRow
            icon={<FileText className="h-3.5 w-3.5 text-accent" />}
            label="SQL DDL"
            sub="CREATE TABLE statements only"
            onClick={() => doExport("sql")}
          />
        </div>
      ) : null}
    </div>
  );
}

function ExportRow({
  icon,
  label,
  sub,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 border-b border-border/40 px-3 py-2 text-left text-xs hover:bg-surfaceAlt/60"
    >
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-border/60 bg-bg/40">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="font-medium text-text">{label}</span>
        <span className="truncate text-[10px] text-muted">{sub}</span>
      </span>
    </button>
  );
}

/* ---------- minimalist SQL DDL renderer ---------- */

function renderSqlDdl(design: FullDesign): string {
  const lines: string[] = [];
  lines.push(
    `-- ${design.domain_analysis?.domain_guess || "Untitled"} schema`,
    `-- Exported from Schema Designer on ${new Date().toISOString()}`,
    ""
  );
  for (const t of design.schema_designs) {
    lines.push(`CREATE TABLE ${quote(t.table_name)} (`);
    const colLines: string[] = [];
    for (const c of t.columns) {
      const pieces: string[] = [`  ${quote(c.name)} ${c.pg_type}`];
      if (c.nullable === false) pieces.push("NOT NULL");
      if (c.unique) pieces.push("UNIQUE");
      if (c.default_expr) pieces.push(`DEFAULT ${c.default_expr}`);
      if (c.check) pieces.push(`CHECK (${c.check})`);
      colLines.push(pieces.join(" "));
    }
    if (t.pk_field) {
      colLines.push(`  PRIMARY KEY (${quote(t.pk_field)})`);
    }
    for (const fk of t.fk_definitions) {
      const trail: string[] = [];
      if (fk.on_delete) trail.push(`ON DELETE ${fk.on_delete}`);
      if (fk.on_update) trail.push(`ON UPDATE ${fk.on_update}`);
      colLines.push(
        `  FOREIGN KEY (${quote(fk.field)}) REFERENCES ${quote(fk.references_table)}(${quote(fk.references_field)})${trail.length ? " " + trail.join(" ") : ""}`
      );
    }
    for (const constraint of t.table_constraints || []) {
      colLines.push(`  ${constraint}`);
    }
    lines.push(colLines.join(",\n"));
    lines.push(`);`);
    lines.push("");
  }
  return lines.join("\n");
}

function quote(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}
