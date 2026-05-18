"use client";

import { motion } from "framer-motion";
import { ArrowRight, Check, Trash2, Undo2, Loader2 } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { applyRevision, dropRevision } from "@/lib/api";
import { useDesignStore } from "@/store/designStore";
import type { DesignRevision, FullDesign, SchemaDesign } from "@/lib/types";

interface DesignDiffPanelProps {
  designId: string;
}

type SimpleDiff = {
  added: string[];
  removed: string[];
  modified: string[];
};

function tableSummary(d: FullDesign | null | undefined) {
  if (!d) return new Map<string, string>();
  const map = new Map<string, string>();
  for (const sd of d.schema_designs) {
    map.set(sd.table_name, JSON.stringify(sd));
  }
  return map;
}

function diffTables(before: FullDesign | null | undefined, after: FullDesign | null | undefined): SimpleDiff {
  const b = tableSummary(before);
  const a = tableSummary(after);
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  for (const [name, bj] of b.entries()) {
    if (!a.has(name)) {
      removed.push(name);
    } else if (a.get(name) !== bj) {
      modified.push(name);
    }
  }
  for (const name of a.keys()) {
    if (!b.has(name)) added.push(name);
  }
  return { added, removed, modified };
}

export function DesignDiffPanel({ designId }: DesignDiffPanelProps) {
  const pending = useDesignStore((s) => s.pendingRevisions);
  const setDesign = useDesignStore((s) => s.setDesign);
  const removePending = useDesignStore((s) => s.removePendingRevision);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  if (!pending.length) {
    return (
      <div className="text-sm text-muted">
        No pending revisions. Use the design chat below to propose changes.
      </div>
    );
  }

  async function approve(rev: DesignRevision) {
    setBusy(rev.revision_id);
    setError(null);
    try {
      const resp = await applyRevision(designId, rev.revision_id);
      if ((resp as { design?: FullDesign }).design) {
        setDesign((resp as { design: FullDesign }).design);
      }
      removePending(rev.revision_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function drop(rev: DesignRevision) {
    setBusy(rev.revision_id);
    setError(null);
    try {
      await dropRevision(designId, rev.revision_id);
      removePending(rev.revision_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}
      {pending.map((rev) => {
        const d = diffTables(rev.before, rev.after);
        const total = d.added.length + d.removed.length + d.modified.length;
        const isBusy = busy === rev.revision_id;
        return (
          <motion.div
            key={rev.revision_id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-2 rounded-lg border border-accent/30 bg-accent/5 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Badge variant="accent">{rev.actor}</Badge>
                <span className="truncate" title={rev.change_summary}>
                  {rev.change_summary || "(no summary)"}
                </span>
              </div>
              <div className="text-[10px] text-muted">{total} table changes</div>
            </div>
            {rev.reasoning ? (
              <div className="text-xs italic text-muted">{rev.reasoning}</div>
            ) : null}
            <DiffDetails diff={d} />
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => approve(rev)}
                disabled={isBusy}
              >
                {isBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Apply
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => drop(rev)}
                disabled={isBusy}
              >
                <Trash2 className="h-4 w-4" />
                Drop
              </Button>
              <Button size="sm" variant="ghost" disabled title="undo coming soon">
                <Undo2 className="h-4 w-4" />
                Undo (after apply)
              </Button>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function DiffDetails({ diff }: { diff: SimpleDiff }) {
  return (
    <div className="flex flex-wrap gap-1 text-[11px]">
      {diff.added.map((t) => (
        <Badge key={`a-${t}`} variant="success">
          <Check className="h-3 w-3" />
          {t}
        </Badge>
      ))}
      {diff.modified.map((t) => (
        <Badge key={`m-${t}`} variant="warning">
          <ArrowRight className="h-3 w-3" />
          {t}
        </Badge>
      ))}
      {diff.removed.map((t) => (
        <Badge key={`r-${t}`} variant="danger">
          <Trash2 className="h-3 w-3" />
          {t}
        </Badge>
      ))}
      {diff.added.length + diff.modified.length + diff.removed.length === 0 ? (
        <span className="text-muted">No structural table changes.</span>
      ) : null}
    </div>
  );
}
