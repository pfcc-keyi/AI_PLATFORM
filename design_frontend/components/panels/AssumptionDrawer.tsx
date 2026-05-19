"use client";

import {
  AlertOctagon,
  AlertTriangle,
  Compass,
  HelpCircle,
  Info,
  Lightbulb,
  MessageSquarePlus,
  X
} from "lucide-react";
import * as React from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDesignStore } from "@/store/designStore";
import type {
  DesignCritique,
  DesignIssue,
  DomainAnalysis,
  IssueSeverity
} from "@/lib/types";

const SEV_ICON: Record<IssueSeverity, React.ReactNode> = {
  info: <Info className="h-3.5 w-3.5 text-muted" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 text-warning" />,
  error: <AlertOctagon className="h-3.5 w-3.5 text-danger" />
};

const SEV_LABEL: Record<IssueSeverity, string> = {
  info: "Nice to have",
  warning: "Worth a look",
  error: "Likely breaks"
};

interface AssumptionDrawerProps {
  domain: DomainAnalysis | undefined;
  critique: DesignCritique | undefined | null;
}

export function AssumptionDrawer({ domain, critique }: AssumptionDrawerProps) {
  const setPendingChatPrompt = useDesignStore((s) => s.setPendingChatPrompt);
  const dismissed = useDesignStore((s) => s.dismissedQuestions);
  const dismissQuestion = useDesignStore((s) => s.dismissQuestion);

  function askAI(prompt: string) {
    setPendingChatPrompt(prompt);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* DOMAIN — what the AI thinks this schema is and where the educated
          guesses are. */}
      {domain ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                <Compass className="h-3.5 w-3.5 text-accent" />
                Domain analysis
              </div>
              <span
                title="The AI's reading of the upload before any per-table design work runs."
                className="cursor-help text-[10px] text-muted"
              >
                what is this schema?
              </span>
            </div>
          </CardHeader>
          <CardBody className="flex flex-col gap-2.5">
            <div className="text-sm">
              <span className="text-muted">Guessed domain:</span>{" "}
              <span className="font-medium text-accent">
                {domain.domain_guess || "unknown"}
              </span>
            </div>
            {domain.sub_domains.length ? (
              <div className="flex flex-col gap-1">
                <div className="text-[10px] uppercase tracking-wider text-muted">
                  Sub-domains
                </div>
                <div className="flex flex-wrap gap-1">
                  {domain.sub_domains.map((d) => (
                    <Badge key={d} variant="accent">
                      {d}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {domain.assumptions.length ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted">
                  <Lightbulb className="h-3 w-3 text-accent" />
                  Assumptions the AI made
                </div>
                <ul className="ml-4 list-disc text-xs text-text/90">
                  {domain.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {domain.reasoning ? (
              <div className="rounded-md border border-border/60 bg-bg/30 p-2 text-xs italic text-muted">
                {domain.reasoning}
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {/* CRITIQUE — what the DesignCriticAgent flagged. */}
      {critique ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                <HelpCircle className="h-3.5 w-3.5 text-accent" />
                Design critique
              </div>
              <span
                title="A second AI pass that looks at the full design as a whole and flags suspicious patterns, missing pieces, or risky decisions."
                className="cursor-help text-[10px] text-muted"
              >
                what could go wrong?
              </span>
            </div>
          </CardHeader>
          <CardBody className="flex flex-col gap-2.5">
            <div className="rounded-md border border-border/60 bg-bg/30 p-2 text-[11px] leading-relaxed text-muted">
              A separate critic agent reviewed the whole design after it was
              generated. Each issue below is a suggestion you can{" "}
              <span className="text-text/90">address with the AI chat</span>{" "}
              (turns it into a revision proposal), or just{" "}
              <span className="text-text/90">ignore</span>.
            </div>

            {critique.summary ? (
              <div className="text-sm text-text/95">{critique.summary}</div>
            ) : null}

            {/* ISSUES */}
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] uppercase tracking-wider text-muted">
                Issues ({(critique.issues ?? []).length})
              </div>
              {(critique.issues ?? []).length === 0 ? (
                <div className="rounded-md border border-dashed border-border/60 px-2 py-2 text-xs text-muted">
                  No issues raised.
                </div>
              ) : (
                (critique.issues ?? [])
                  .slice(0, 30)
                  .map((i, idx) => (
                    <IssueRow
                      key={`${i.target}-${idx}`}
                      issue={i}
                      onAskAI={askAI}
                    />
                  ))
              )}
            </div>

            {/* OPEN QUESTIONS — now actionable, not just flat text */}
            {critique.open_questions && critique.open_questions.length ? (
              <div className="flex flex-col gap-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted">
                  Open questions ({critique.open_questions.length})
                </div>
                <div className="rounded-md border border-border/60 bg-bg/30 px-2 py-1.5 text-[10px] text-muted">
                  Things the AI couldn&apos;t decide for you. Pick one to
                  discuss with the AI chat — your answer becomes a revision.
                </div>
                {critique.open_questions
                  .filter((q) => !dismissed.has(q))
                  .map((q, i) => (
                    <OpenQuestionRow
                      key={`q-${i}`}
                      question={q}
                      onAskAI={askAI}
                      onDismiss={dismissQuestion}
                    />
                  ))}
                {critique.open_questions.every((q) => dismissed.has(q)) ? (
                  <div className="px-2 py-1 text-[11px] text-muted">
                    All questions dismissed.
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function IssueRow({
  issue: i,
  onAskAI
}: {
  issue: DesignIssue;
  onAskAI: (text: string) => void;
}) {
  const prompt = buildIssuePrompt(i);
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border/60 bg-bg/30 px-2 py-1.5 text-xs">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex-shrink-0" title={SEV_LABEL[i.severity]}>
          {SEV_ICON[i.severity]}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="break-all font-mono text-[10px] text-muted">
            {i.target || "—"}
          </span>
          <span className="text-text">{i.message}</span>
          {i.suggested_fix ? (
            <span className="mt-0.5 text-[11px] italic text-accent">
              Suggested fix: {i.suggested_fix}
            </span>
          ) : null}
        </div>
      </div>
      <button
        onClick={() => onAskAI(prompt)}
        className="ml-6 inline-flex w-fit items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/20"
        title="Open the chat with this issue pre-filled as a refinement request"
      >
        <MessageSquarePlus className="h-3 w-3" />
        Address with AI
      </button>
    </div>
  );
}

function OpenQuestionRow({
  question,
  onAskAI,
  onDismiss
}: {
  question: string;
  onAskAI: (text: string) => void;
  onDismiss: (q: string) => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/60 bg-bg/30 px-2 py-1.5 text-xs">
      <HelpCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-accentAlt" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-text/90">{question}</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() =>
              onAskAI(`Address this open question: ${question}`)
            }
            className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/20"
          >
            <MessageSquarePlus className="h-3 w-3" />
            Discuss with AI
          </button>
          <button
            onClick={() => onDismiss(question)}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-bg/60 px-2 py-0.5 text-[10px] text-muted hover:bg-surfaceAlt hover:text-text"
            title="Hide this question from the panel"
          >
            <X className="h-3 w-3" />
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

function buildIssuePrompt(i: DesignIssue): string {
  const tgt = i.target ? `Target: ${i.target}. ` : "";
  const fix = i.suggested_fix ? ` Suggested fix: ${i.suggested_fix}.` : "";
  return `${tgt}Issue: ${i.message}.${fix} Propose a revision that resolves this.`;
}
