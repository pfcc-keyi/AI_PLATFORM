"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  Cog,
  Crosshair,
  Layers3,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  TriangleAlert,
  XCircle,
  ZoomOut
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { QueryProvider } from "@/components/QueryProvider";
import { Button } from "@/components/ui/button";
import {
  critiqueDesign,
  deleteDesign,
  getDesign,
  reviewDesign
} from "@/lib/api";
import { useDesignStore } from "@/store/designStore";
import { useEventsStore } from "@/store/eventsStore";
import { useDesignStream } from "@/lib/sse";
import { fallbackLayout } from "@/lib/layout3d";
import { cn } from "@/lib/utils";
import { TableInspector } from "@/components/panels/TableInspector";
import { FieldInspector } from "@/components/panels/FieldInspector";
import { ActivityPanel } from "@/components/panels/ActivityPanel";
import { HandlersPanel } from "@/components/panels/HandlersPanel";
import { AssumptionDrawer } from "@/components/panels/AssumptionDrawer";
import { DesignDiffPanel } from "@/components/panels/DesignDiffPanel";
import { ClarificationCard } from "@/components/panels/ClarificationCard";
import { DesignChat } from "@/components/chat/DesignChat";
import { MiniMap } from "@/components/scene/MiniMap";
import { ResizableRail } from "@/components/panels/ResizableRail";
import { AboutCockpit } from "@/components/panels/AboutCockpit";
import { ExportButton } from "@/components/panels/ExportButton";

const Scene3D = dynamic(
  () => import("@/components/scene/Scene3D").then((m) => m.Scene3D),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
          <div className="text-sm">Composing 3D scene…</div>
        </div>
      </div>
    )
  }
);

type RailTab = "activity" | "handlers" | "critique" | "revisions";

const RAIL_TABS: { id: RailTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "activity", label: "Activity", icon: Activity },
  { id: "handlers", label: "Handlers", icon: Cog },
  { id: "critique", label: "Critique", icon: TriangleAlert },
  { id: "revisions", label: "Revisions", icon: Sparkles }
];

function PhaseChip({ phase }: { phase: string }) {
  if (!phase) return null;
  const palette: Record<string, string> = {
    parsing: "bg-muted/15 text-muted",
    analyzing: "bg-accentAlt/15 text-accentAlt",
    awaiting_clarification: "bg-warning/15 text-warning animate-pulseGlow",
    designing: "bg-accent/15 text-accent",
    synthesizing: "bg-accent/15 text-accent",
    awaiting_review: "bg-success/15 text-success",
    ready: "bg-success/15 text-success",
    rejected: "bg-danger/15 text-danger"
  };
  const label = phase.replace(/_/g, " ");
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-tight",
        palette[phase] ?? "bg-muted/15 text-muted"
      )}
    >
      {label}
    </span>
  );
}

function DesignPageInner({ designId }: { designId: string }) {
  const router = useRouter();
  useDesignStream(designId);

  const setDesignId = useDesignStore((s) => s.setDesignId);
  const setDesign = useDesignStore((s) => s.setDesign);
  const setQuestions = useDesignStore((s) => s.setQuestions);
  const setClarificationRound = useDesignStore((s) => s.setClarificationRound);
  const design = useDesignStore((s) => s.design);
  const questions = useDesignStore((s) => s.questions);
  const round = useDesignStore((s) => s.clarificationRound);
  const selection = useDesignStore((s) => s.selection);
  const setSelection = useDesignStore((s) => s.setSelection);
  const focusedCluster = useDesignStore((s) => s.focusedCluster);
  const setFocusedCluster = useDesignStore((s) => s.setFocusedCluster);
  const pendingRevisions = useDesignStore((s) => s.pendingRevisions);
  const phaseEvt = useEventsStore((s) => s.phase);
  const clearEvents = useEventsStore((s) => s.clear);

  const [leftOpen, setLeftOpen] = React.useState(true);
  const [rightTab, setRightTab] = React.useState<RailTab>("activity");
  const [reviewBusy, setReviewBusy] = React.useState<string | null>(null);
  const [tableSearch, setTableSearch] = React.useState("");

  // Bumped to imperatively retarget the camera (locate, reset).
  const [focusToken, setFocusToken] = React.useState(0);
  const [resetToken, setResetToken] = React.useState(0);

  React.useEffect(() => {
    setDesignId(designId);
    return () => {
      clearEvents();
      setDesign(undefined);
      setQuestions([]);
      setSelection({ kind: "none" });
      setFocusedCluster(undefined);
    };
  }, [
    designId,
    setDesignId,
    setDesign,
    setQuestions,
    setSelection,
    setFocusedCluster,
    clearEvents
  ]);

  const { data: queryData, isLoading, error, refetch } = useQuery({
    queryKey: ["design", designId],
    queryFn: () => getDesign(designId),
    refetchOnWindowFocus: false,
    retry: (failureCount, err) => {
      if (err instanceof Error && /^404\b/.test(err.message)) return false;
      return failureCount < 1;
    },
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return 2000;
      const p = (data as { phase?: string }).phase;
      return p && p !== "ready" && p !== "rejected" ? 2500 : false;
    }
  });

  React.useEffect(() => {
    if (!queryData) return;
    if ((queryData as { design?: unknown }).design) {
      setDesign((queryData as { design: any }).design);
    }
    setQuestions((queryData as { questions?: string[] }).questions ?? []);
    setClarificationRound(
      (queryData as { clarification_round?: number }).clarification_round ?? 0
    );
  }, [queryData, setDesign, setQuestions, setClarificationRound]);

  const layout = React.useMemo(() => fallbackLayout(design), [design]);
  const phase = phaseEvt || (queryData as { phase?: string })?.phase || "";

  const selectedTableName =
    selection.kind === "table"
      ? selection.tableName
      : selection.kind === "field"
        ? selection.tableName
        : undefined;

  const selectedTable = React.useMemo(() => {
    if (!design || !selectedTableName) return undefined;
    return design.schema_designs.find((sd) => sd.table_name === selectedTableName);
  }, [design, selectedTableName]);

  // Auto-switch right rail when interesting things happen. While the AI is
  // still running, keep the Activity tab open so the user sees the progress
  // stepper and the domain analysis card. Once the design is ready, switch
  // to Critique if there are issues to address; otherwise to Handlers so the
  // user can immediately review the suggested business logic.
  React.useEffect(() => {
    if (selection.kind !== "none") return;
    if (
      phase === "designing" ||
      phase === "synthesizing" ||
      phase === "analyzing" ||
      phase === "parsing"
    ) {
      setRightTab("activity");
    } else if (phase === "awaiting_review" || phase === "ready") {
      if (design?.critique && (design.critique.issues?.length ?? 0) > 0) {
        setRightTab("critique");
      } else if ((design?.handler_sketches?.length ?? 0) > 0) {
        setRightTab("handlers");
      } else {
        setRightTab("activity");
      }
    }
  }, [phase, selection.kind, design]);

  // When a table is picked from the minimap or cluster list, reframe the
  // camera even if the selection was already that table.
  const requestCameraFocus = React.useCallback(() => {
    setFocusToken((n) => n + 1);
  }, []);

  const handlePickTableFromMap = React.useCallback(
    (tableName: string) => {
      setSelection({ kind: "table", tableName });
      requestCameraFocus();
    },
    [setSelection, requestCameraFocus]
  );

  const handlePickCluster = React.useCallback(
    (clusterId: string | undefined) => {
      setFocusedCluster(clusterId);
      // Clear table selection when switching clusters so camera frames
      // the whole cluster cleanly.
      setSelection({ kind: "none" });
      requestCameraFocus();
    },
    [setFocusedCluster, setSelection, requestCameraFocus]
  );

  const handleResetView = React.useCallback(() => {
    setSelection({ kind: "none" });
    setFocusedCluster(undefined);
    setResetToken((n) => n + 1);
  }, [setSelection, setFocusedCluster]);

  async function handleDelete() {
    if (!confirm("Delete this design? This cannot be undone.")) return;
    await deleteDesign(designId);
    router.push("/");
  }

  async function handleRecritique() {
    try {
      const resp = await critiqueDesign(designId, "global");
      if (resp.design) setDesign(resp.design);
      else refetch();
    } catch {
      refetch();
    }
  }

  async function handleReview(action: "approved" | "revise" | "reject") {
    setReviewBusy(action);
    try {
      await reviewDesign(designId, action);
      refetch();
    } finally {
      setReviewBusy(null);
    }
  }

  if (isLoading && !design) {
    return (
      <div className="flex h-screen items-center justify-center text-muted">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading design…
      </div>
    );
  }

  if (error) {
    const msg = String(error);
    const is404 = /\b404\b/.test(msg);
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="max-w-xl text-danger">
          {is404 ? (
            <>
              <div className="text-lg font-semibold">
                This design isn&apos;t on the backend.
              </div>
              <div className="mt-2 text-sm text-danger/90">
                The backend service may have restarted before the design
                finished and was persisted. Please go back and upload again.
              </div>
            </>
          ) : (
            <>Failed to load design: {msg}</>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => refetch()}>
            Retry
          </Button>
          <Link href="/">
            <Button variant="ghost">Back to uploads</Button>
          </Link>
        </div>
      </div>
    );
  }

  const showClarification =
    phase === "awaiting_clarification" && questions.length > 0;
  const tableCount = design?.schema_designs.length ?? 0;
  const clusters = design?.domain_analysis?.clusters ?? [];
  const inspectorOpen = selection.kind !== "none" && !!selectedTable;

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* 3D scene */}
      <div className="absolute inset-0">
        {design ? (
          <Scene3D
            design={design}
            layout={layout}
            selectedTable={selectedTableName}
            focusedCluster={focusedCluster}
            focusToken={focusToken}
            resetToken={resetToken}
            onSelectTable={(name) => {
              setSelection({ kind: "table", tableName: name });
              requestCameraFocus();
            }}
            onClearSelection={() => setSelection({ kind: "none" })}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
            <div className="text-sm">Generating your design…</div>
          </div>
        )}
      </div>

      {/* Top bar */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4">
        <div className="pointer-events-auto flex max-w-[min(60vw,560px)] items-center gap-3 rounded-full border border-border bg-surface/80 px-3 py-1.5 backdrop-blur">
          <Link
            href="/"
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-muted hover:bg-surfaceAlt hover:text-text"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span
            className="truncate whitespace-nowrap text-sm font-medium tracking-tight"
            title={design?.domain_analysis?.domain_guess ?? "Schema design"}
          >
            {design?.domain_analysis?.domain_guess ?? "Schema design"}
          </span>
          {design ? (
            <span className="flex-shrink-0 whitespace-nowrap text-[11px] text-muted">
              · {tableCount} tables
            </span>
          ) : null}
          <PhaseChip phase={phase} />
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          {phase === "awaiting_review" || phase === "ready" ? (
            <>
              <Button
                size="sm"
                onClick={() => handleReview("approved")}
                disabled={reviewBusy !== null}
              >
                {reviewBusy === "approved" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Approve
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => handleReview("revise")}
                disabled={reviewBusy !== null}
              >
                {reviewBusy === "revise" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                Revise
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => handleReview("reject")}
                disabled={reviewBusy !== null}
              >
                {reviewBusy === "reject" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                Reject
              </Button>
            </>
          ) : null}
          <Button size="sm" variant="ghost" onClick={handleRecritique} title="Re-run critic">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <ExportButton design={design} />
          <AboutCockpit />
          <Button size="sm" variant="ghost" onClick={handleDelete} title="Delete design">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Left rail: clusters + table search/picker + minimap at bottom */}
      <aside
        className={cn(
          "pointer-events-auto absolute left-4 top-20 z-10 flex flex-col gap-2 rounded-2xl border border-border bg-surface/80 backdrop-blur",
          leftOpen ? "w-[260px] p-3" : "w-12 items-center p-2"
        )}
        style={{ maxHeight: "calc(100vh - 6rem - 1rem)" }}
      >
        {/* All the controls below this comment fit inside the rail; the
            inner table-list takes the remaining vertical space and scrolls.
            The minimap is pinned at the bottom of the rail so it never
            visually conflicts with the table list or the 3D scene chrome. */}
        <button
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-surfaceAlt hover:text-text"
          onClick={() => setLeftOpen((o) => !o)}
          title={leftOpen ? "Collapse" : "Expand"}
        >
          <ChevronLeft
            className={cn("h-3.5 w-3.5 transition", !leftOpen && "rotate-180")}
          />
        </button>
        {leftOpen ? (
          <>
            {/* Search field (always shown when expanded) */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Search tables…"
                className="w-full rounded-md border border-border bg-bg/40 py-1.5 pl-7 pr-2 text-xs outline-none placeholder:text-muted focus:border-accent"
                data-testid="table-search"
              />
            </div>

            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
              <Layers3 className="h-3 w-3 text-accent" />
              Clusters & tables
            </div>
            <div
              className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1"
              // Reserved for: rail max-height − (search + headings + minimap
              // + paddings). Tweak if minimap height changes.
              style={{ maxHeight: "calc(100vh - 6rem - 1rem - 180px)" }}
            >
              <button
                className={cn(
                  "rounded-md px-2 py-1 text-left text-xs hover:bg-surfaceAlt",
                  !focusedCluster && "bg-accent/15 text-accent"
                )}
                onClick={() => handlePickCluster(undefined)}
              >
                All{" "}
                <span className="text-[10px] text-muted">
                  · {clusters.length} clusters / {tableCount} tables
                </span>
              </button>
              {clusters.map((c) => {
                const filtered = tableSearch
                  ? c.table_names.filter((tn) =>
                      tn.toLowerCase().includes(tableSearch.toLowerCase())
                    )
                  : c.table_names;
                if (tableSearch && filtered.length === 0) return null;
                const isActive = focusedCluster === c.cluster_id;
                return (
                  <div
                    key={c.cluster_id}
                    className="flex flex-col gap-0.5"
                  >
                    <button
                      className={cn(
                        "flex items-center justify-between gap-1 rounded-md px-2 py-1 text-left text-xs hover:bg-surfaceAlt",
                        isActive && "bg-accent/15 text-accent"
                      )}
                      onClick={() => handlePickCluster(c.cluster_id)}
                      title={c.rationale}
                    >
                      <span className="truncate">
                        {c.name || c.cluster_id}
                      </span>
                      <span className="ml-1 flex-shrink-0 text-[10px] text-muted">
                        {filtered.length}
                      </span>
                    </button>
                    {/* Table rows: show when search active OR cluster is focused */}
                    {(tableSearch || isActive) && filtered.length > 0 ? (
                      <ul className="ml-3 flex flex-col gap-px border-l border-border/70 pl-2">
                        {filtered.map((tn) => {
                          const sel = tn === selectedTableName;
                          return (
                            <li key={tn}>
                              <button
                                data-testid={`table-row-${tn}`}
                                data-table={tn}
                                onClick={() => handlePickTableFromMap(tn)}
                                className={cn(
                                  "block w-full truncate rounded-sm px-1.5 py-0.5 text-left font-mono text-[11px] hover:bg-surfaceAlt",
                                  sel ? "bg-accent/20 text-accent" : "text-text/90"
                                )}
                                title={`Focus camera on ${tn}`}
                              >
                                {tn}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
              {clusters.length === 0 ? (
                <div className="px-2 py-1 text-[11px] text-muted">
                  No clusters yet.
                </div>
              ) : null}
              {tableSearch &&
              clusters.every(
                (c) =>
                  c.table_names.filter((tn) =>
                    tn.toLowerCase().includes(tableSearch.toLowerCase())
                  ).length === 0
              ) ? (
                <div className="px-2 py-2 text-[11px] text-muted">
                  No tables match &quot;{tableSearch}&quot;.
                </div>
              ) : null}
            </div>
            {/* Minimap pinned at the bottom of the left rail */}
            {design ? (
              <div className="mt-1 border-t border-border/60 pt-2">
                <MiniMap
                  layout={layout}
                  selectedTable={selectedTableName}
                  focusedCluster={focusedCluster}
                  onPickTable={handlePickTableFromMap}
                />
              </div>
            ) : null}
          </>
        ) : (
          <Layers3 className="mt-1 h-4 w-4 text-accent" />
        )}
      </aside>

      {/* Right rail: contextual (tabs OR table/field inspector) — resizable */}
      <ResizableRail
        storageKey="cockpit_right_rail_width"
        defaultWidth={400}
        minWidth={340}
        maxWidth={760}
        className="absolute right-4 top-20 z-10"
        style={{ maxHeight: "calc(100vh - 6rem - 1rem)" }}
      >
        {inspectorOpen ? (
          <>
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <button
                className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-surfaceAlt hover:text-text"
                onClick={() =>
                  setSelection(
                    selection.kind === "field" && selectedTable
                      ? { kind: "table", tableName: selectedTable.table_name }
                      : { kind: "none" }
                  )
                }
                title="Back"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="text-xs uppercase tracking-wider text-muted">
                {selection.kind === "field" ? "Field" : "Table"}
              </div>
              <span className="truncate font-mono text-sm">
                {selection.kind === "field"
                  ? `${selection.tableName}.${selection.fieldName}`
                  : selectedTable?.table_name}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {selection.kind === "field" && selectedTable ? (
                <FieldInspector
                  designId={designId}
                  table={selectedTable}
                  fieldName={selection.fieldName}
                  initialState={selection.stateName}
                  design={design}
                />
              ) : selectedTable ? (
                <TableInspector
                  table={selectedTable}
                  design={design}
                  onLocate={requestCameraFocus}
                  onSelectField={(fieldName) =>
                    setSelection({
                      kind: "field",
                      tableName: selectedTable.table_name,
                      fieldName,
                      stateName: selectedTable.states[0]
                    })
                  }
                />
              ) : null}
            </div>
          </>
        ) : (
          <>
            <div className="flex gap-0 border-b border-border">
              {RAIL_TABS.map((t) => {
                const Icon = t.icon;
                const active = rightTab === t.id;
                const badgeCount =
                  t.id === "critique"
                    ? design?.critique?.issues?.length ?? 0
                    : t.id === "handlers"
                      ? design?.handler_sketches?.length ?? 0
                      : t.id === "revisions"
                        ? pendingRevisions.length
                        : 0;
                return (
                  <button
                    key={t.id}
                    onClick={() => setRightTab(t.id)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2 text-[11px] font-medium tracking-wide transition",
                      active
                        ? "border-accent text-text"
                        : "border-transparent text-muted hover:text-text"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t.label}
                    {badgeCount > 0 ? (
                      <span
                        className={cn(
                          "rounded-full px-1.5 text-[10px]",
                          active
                            ? "bg-accent/20 text-accent"
                            : "bg-muted/20 text-muted"
                        )}
                      >
                        {badgeCount}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="flex-1 overflow-y-auto">
              {rightTab === "activity" ? (
                <div className="p-3">
                  <ActivityPanel
                    phase={phase}
                    domain={design?.domain_analysis}
                  />
                </div>
              ) : null}
              {rightTab === "handlers" ? (
                <div className="p-3">
                  <HandlersPanel
                    design={design}
                    designId={designId}
                    onPickTable={handlePickTableFromMap}
                  />
                </div>
              ) : null}
              {rightTab === "critique" ? (
                <div className="p-3">
                  <AssumptionDrawer
                    critique={design?.critique ?? undefined}
                  />
                </div>
              ) : null}
              {rightTab === "revisions" ? (
                <div className="p-3">
                  <DesignDiffPanel designId={designId} />
                </div>
              ) : null}
            </div>
          </>
        )}
      </ResizableRail>

      {/* Bottom-LEFT controls: chat + reset + locate (minimap now lives in
          the left rail so it doesn't fight the rail for vertical space). */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-20 flex items-center gap-2">
        <div className="pointer-events-auto flex items-center gap-2">
          <DesignChat designId={designId} />
          {design ? (
            <>
              <button
                onClick={handleResetView}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface/85 px-3 text-xs font-medium text-muted backdrop-blur hover:bg-surfaceAlt hover:text-text"
                title="Reset camera"
              >
                <ZoomOut className="h-3.5 w-3.5" />
                Reset view
              </button>
              {selectedTableName ? (
                <button
                  onClick={requestCameraFocus}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 text-xs font-medium text-accent backdrop-blur hover:bg-accent/20"
                  title="Re-frame the selected table"
                >
                  <Crosshair className="h-3.5 w-3.5" />
                  Locate
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {/* Clarification modal — centered, impossible to miss */}
      <AnimatePresence>
        {showClarification ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-30 flex items-center justify-center bg-bg/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="w-[min(640px,calc(100vw-2rem))]"
            >
              <ClarificationCard
                designId={designId}
                questions={questions}
                round={round}
              />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default function DesignPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  if (!id) return null;
  return (
    <QueryProvider>
      <DesignPageInner designId={id} />
    </QueryProvider>
  );
}
