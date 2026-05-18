"use client";

import * as React from "react";
import { Loader2, MessagesSquare, ArrowRight } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { answerDesign } from "@/lib/api";
import { useDesignStore } from "@/store/designStore";

interface ClarificationCardProps {
  designId: string;
  questions: string[];
  round?: number;
}

export function ClarificationCard({
  designId,
  questions,
  round = 0
}: ClarificationCardProps) {
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const setQuestions = useDesignStore((s) => s.setQuestions);
  const setClarificationRound = useDesignStore((s) => s.setClarificationRound);

  async function submit() {
    if (Object.values(answers).filter((v) => v.trim()).length === 0) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      const resp = await answerDesign(designId, answers);
      setQuestions(resp.questions ?? []);
      setClarificationRound(resp.clarification_round ?? round + 1);
      if (!resp.questions || resp.questions.length === 0) {
        setAnswers({});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  if (!questions.length) return null;

  return (
    <Card className="border-accent/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <MessagesSquare className="h-4 w-4 text-accent" />
            Clarification needed
          </div>
          {round > 0 ? (
            <span className="text-[10px] text-muted">round {round}</span>
          ) : null}
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {questions.map((q, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="text-sm">{q}</div>
            <Textarea
              placeholder="Your answer..."
              value={answers[q] || ""}
              onChange={(e) => setAnswers({ ...answers, [q]: e.target.value })}
            />
          </div>
        ))}
        {error ? (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        ) : null}
        <Button onClick={submit} disabled={sending} className="self-start">
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
          Submit answers
        </Button>
      </CardBody>
    </Card>
  );
}
