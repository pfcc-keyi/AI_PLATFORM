"use client";

import { motion } from "framer-motion";
import { CheckCircle2, RotateCcw, XCircle, Loader2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { reviewDesign } from "@/lib/api";
import { useDesignStore } from "@/store/designStore";

interface ReviewBarProps {
  designId: string;
  phase: string;
}

export function ReviewBar({ designId, phase }: ReviewBarProps) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const visible = phase === "awaiting_review" || phase === "refining";
  if (!visible) return null;

  async function send(action: "approved" | "revise" | "reject") {
    setBusy(action);
    setError(null);
    try {
      await reviewDesign(designId, action);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.div
      initial={{ y: -8, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="flex items-center gap-2 rounded-lg border border-accent/50 bg-accent/10 px-3 py-2"
    >
      <div className="text-sm">
        <span className="font-semibold">Ready for review.</span>{" "}
        Apply changes, request a revision, or reject.
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => send("approved")}
          disabled={busy !== null}
        >
          {busy === "approved" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          Approve
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => send("revise")}
          disabled={busy !== null}
        >
          {busy === "revise" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4" />
          )}
          Revise
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => send("reject")}
          disabled={busy !== null}
        >
          {busy === "reject" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          Reject
        </Button>
      </div>
      {error ? (
        <div className="ml-2 text-xs text-danger">{error}</div>
      ) : null}
    </motion.div>
  );
}
