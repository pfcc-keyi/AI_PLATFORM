"use client";

import { Lightbulb, HelpCircle, AlertTriangle, Info, AlertOctagon } from "lucide-react";
import * as React from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DesignCritique, DomainAnalysis, IssueSeverity } from "@/lib/types";

const SEV_ICON: Record<IssueSeverity, React.ReactNode> = {
  info: <Info className="h-3.5 w-3.5 text-muted" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 text-warning" />,
  error: <AlertOctagon className="h-3.5 w-3.5 text-danger" />
};

interface AssumptionDrawerProps {
  domain: DomainAnalysis | undefined;
  critique: DesignCritique | undefined | null;
}

export function AssumptionDrawer({ domain, critique }: AssumptionDrawerProps) {
  const issues = critique?.issues ?? [];
  return (
    <div className="flex flex-col gap-3">
      {domain ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
              <Lightbulb className="h-3.5 w-3.5 text-accent" />
              Assumptions
            </div>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            <div className="text-sm">
              Domain guess:{" "}
              <span className="font-medium text-accent">
                {domain.domain_guess || "unknown"}
              </span>
            </div>
            {domain.sub_domains.length ? (
              <div className="flex flex-wrap gap-1">
                {domain.sub_domains.map((d) => (
                  <Badge key={d} variant="accent">
                    {d}
                  </Badge>
                ))}
              </div>
            ) : null}
            {domain.assumptions.length ? (
              <ul className="ml-4 list-disc text-xs text-muted">
                {domain.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            ) : null}
            {domain.reasoning ? (
              <div className="text-xs italic text-muted">{domain.reasoning}</div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {critique ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
              <HelpCircle className="h-3.5 w-3.5 text-accent" />
              Critique
            </div>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            {critique.summary ? (
              <div className="text-sm">{critique.summary}</div>
            ) : null}
            <div className="flex flex-col gap-1">
              {issues.length === 0 ? (
                <div className="text-xs text-muted">No issues raised.</div>
              ) : (
                issues.slice(0, 20).map((i, idx) => (
                  <div
                    key={`${i.target}-${idx}`}
                    className="flex items-start gap-2 rounded-md border border-border/60 bg-bg/30 px-2 py-1.5 text-xs"
                  >
                    {SEV_ICON[i.severity]}
                    <div className="flex flex-col">
                      <span className="font-mono text-[11px] text-muted">
                        {i.target}
                      </span>
                      <span>{i.message}</span>
                      {i.suggested_fix ? (
                        <span className="text-[11px] italic text-accent">
                          {i.suggested_fix}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
            {critique.open_questions && critique.open_questions.length ? (
              <div className="flex flex-col gap-1">
                <div className="text-[11px] uppercase tracking-wider text-muted">
                  Open questions
                </div>
                <ul className="ml-4 list-disc text-xs text-muted">
                  {critique.open_questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
