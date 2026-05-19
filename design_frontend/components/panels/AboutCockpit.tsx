"use client";

import * as React from "react";
import {
  ArrowRight,
  Compass,
  Cog,
  HelpCircle,
  Layers3,
  Sparkles,
  TriangleAlert,
  X
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Short, friendly explainer of what each panel in the cockpit is and what
 * the user can do with it. Opens as a popover from the top-bar help button.
 *
 * The goal is to answer "wait, what IS this Critique / open-question /
 * handler thing?" without forcing the user to read docs.
 */
export function AboutCockpit() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="What am I looking at?"
        aria-label="What am I looking at?"
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surfaceAlt hover:text-text"
      >
        <HelpCircle className="h-4 w-4" />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-bg/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              onClick={(e) => e.stopPropagation()}
              className="w-[min(640px,calc(100vw-2rem))] rounded-2xl border border-border bg-surface/95 p-5 shadow-glow backdrop-blur"
            >
              <div className="mb-4 flex items-start justify-between">
                <div className="flex flex-col gap-0.5">
                  <div className="text-lg font-semibold">
                    Schema design cockpit
                  </div>
                  <div className="text-xs text-muted">
                    Upload Excel → AI proposes a schema → you iterate with
                    chat → export when happy.
                  </div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surfaceAlt hover:text-text"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Block
                  icon={<Layers3 className="h-3.5 w-3.5 text-accent" />}
                  title="Clusters & tables"
                >
                  The AI groups related tables into{" "}
                  <span className="text-text">business clusters</span>. Click
                  a cluster to focus the 3D camera; type in the search box to
                  jump straight to a table.
                </Block>

                <Block
                  icon={<Compass className="h-3.5 w-3.5 text-accent" />}
                  title="Domain analysis"
                >
                  The AI&apos;s reading of the upload:{" "}
                  <span className="text-text">guessed domain</span>,
                  sub-domains, and{" "}
                  <span className="text-text">assumptions</span> it made when
                  filling in missing details.
                </Block>

                <Block
                  icon={<TriangleAlert className="h-3.5 w-3.5 text-warning" />}
                  title="Critique"
                >
                  A second AI pass that reviews the whole design and flags{" "}
                  <span className="text-text">suspicious patterns</span>,
                  missing pieces, or risky decisions. Each issue has an{" "}
                  <em>Address with AI</em> button that turns it into a
                  refinement.
                </Block>

                <Block
                  icon={<HelpCircle className="h-3.5 w-3.5 text-accentAlt" />}
                  title="Open questions"
                >
                  Things the AI couldn&apos;t decide on its own. They&apos;re
                  not bugs — they&apos;re <em>decisions</em> waiting for you.
                  Click <em>Discuss with AI</em> to talk through one, or{" "}
                  <em>Dismiss</em> to hide it.
                </Block>

                <Block
                  icon={<Cog className="h-3.5 w-3.5 text-accent" />}
                  title="Handlers"
                >
                  Per-field business logic the AI proposes (e.g.{" "}
                  <code className="font-mono text-[10px] text-accent">
                    approve_transaction
                  </code>
                  ). They&apos;re sketches with{" "}
                  <span className="text-text">what / why / how</span> — not
                  executable yet, but shaped so the existing ConfigFlow can
                  codegen them later. Click any column in the table inspector
                  to ask for suggestions.
                </Block>

                <Block
                  icon={<Sparkles className="h-3.5 w-3.5 text-accent" />}
                  title="Revisions"
                >
                  Every refinement from chat / Address with AI generates a
                  <span className="text-text"> revision proposal</span> with a
                  before/after diff. Approve to apply, drop to discard, or
                  restore an old revision.
                </Block>
              </div>

              <div className="mt-4 rounded-md border border-border/60 bg-bg/30 px-3 py-2 text-[11px] text-muted">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                  <ArrowRight className="h-3 w-3 text-accent" />
                  Typical loop
                </div>
                Upload → answer clarifying questions → review the proposed
                design → address critique / open questions in chat → approve
                the final design.
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function Block({
  icon,
  title,
  children
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-bg/30 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        {icon}
        {title}
      </div>
      <div className="text-xs leading-relaxed text-text/90">{children}</div>
    </div>
  );
}
