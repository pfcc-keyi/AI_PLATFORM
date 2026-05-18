"use client";

import { Badge } from "@/components/ui/badge";
import type { DesignIssue } from "@/lib/types";

interface ConfidenceLegendProps {
  issues: DesignIssue[];
}

export function ConfidenceLegend({ issues }: ConfidenceLegendProps) {
  if (!issues.length) {
    return null;
  }
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const infos = issues.filter((i) => i.severity === "info").length;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      {errors > 0 ? <Badge variant="danger">{errors} errors</Badge> : null}
      {warnings > 0 ? <Badge variant="warning">{warnings} warnings</Badge> : null}
      {infos > 0 ? <Badge variant="muted">{infos} info</Badge> : null}
    </div>
  );
}
