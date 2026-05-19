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
                  title="Clusters & tables (left rail)"
                >
                  The AI groups related tables into{" "}
                  <span className="text-text">business clusters</span>. Click
                  a cluster to focus the 3D camera; type in the search box to
                  jump straight to a table. Map at the bottom of the rail
                  highlights selection.
                </Block>

                <Block
                  icon={<Compass className="h-3.5 w-3.5 text-accent" />}
                  title="Activity tab"
                >
                  Live <span className="text-text">pipeline stepper</span>{" "}
                  showing which of the 7 design phases is running, plus the AI&apos;s{" "}
                  <span className="text-text">domain analysis</span> — guessed
                  domain, sub-domains, and assumptions.
                </Block>

                <Block
                  icon={<Cog className="h-3.5 w-3.5 text-accent" />}
                  title="Handlers tab"
                >
                  Every{" "}
                  <span className="text-text">handler sketch</span> the AI has
                  proposed so far, grouped by table. Each card expands to show
                  the steps, fields touched, and why it fires. Use{" "}
                  <em>Suggest more handlers</em> at the bottom to ask the AI
                  to fill gaps.
                </Block>

                <Block
                  icon={<TriangleAlert className="h-3.5 w-3.5 text-warning" />}
                  title="Critique tab"
                >
                  A second AI pass that reviews the whole design and flags{" "}
                  <span className="text-text">suspicious patterns</span>,
                  missing pieces, or risky decisions. Includes{" "}
                  <em>open questions</em> the AI wants you to decide. Both
                  have <em>Address with AI</em> buttons that route to the chat.
                </Block>

                <Block
                  icon={<Sparkles className="h-3.5 w-3.5 text-accent" />}
                  title="Revisions tab"
                >
                  Every refinement from chat or <em>Address with AI</em>{" "}
                  generates a <span className="text-text">revision proposal</span>{" "}
                  with a before/after diff. Approve to apply, drop to discard.
                </Block>

                <Block
                  icon={<HelpCircle className="h-3.5 w-3.5 text-accentAlt" />}
                  title="Click a table / field"
                >
                  Tables show their{" "}
                  <span className="text-text">state machine</span>, columns,
                  FKs, and related handlers. Click a column to see, per state,
                  which actions and handlers touch that field as the row leaves
                  that state.
                </Block>
              </div>

              <div className="mt-4 rounded-md border border-border/60 bg-bg/30 px-3 py-2 text-[11px] text-muted">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                  <ArrowRight className="h-3 w-3 text-accent" />
                  Typical loop
                </div>
                Upload → answer clarifying questions → watch the{" "}
                <span className="text-text">Activity</span> stepper run →
                browse tables / handlers → address critique &amp; open questions in
                chat → <span className="text-text">Export</span> to YAML/JSON/SQL
                or Approve.
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
