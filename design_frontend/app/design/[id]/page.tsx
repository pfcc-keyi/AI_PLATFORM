"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronRight,
  Database,
  ListTree,
  Loader2,
  Network,
  Trash2,
  RefreshCw
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { QueryProvider } from "@/components/QueryProvider";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Sheet } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { getDesign, deleteDesign, critiqueDesign } from "@/lib/api";
import { useDesignStore } from "@/store/designStore";
import { useEventsStore } from "@/store/eventsStore";
import { useDesignStream } from "@/lib/sse";
import { fallbackLayout } from "@/lib/layout3d";
import { TableInspector } from "@/components/panels/TableInspector";
import { FieldInspector } from "@/components/panels/FieldInspector";
import { AIThinkingStream } from "@/components/panels/AIThinkingStream";
import { AssumptionDrawer } from "@/components/panels/AssumptionDrawer";
import { ConfidenceLegend } from "@/components/panels/ConfidenceLegend";
import { DesignDiffPanel } from "@/components/panels/DesignDiffPanel";
import { ClarificationCard } from "@/components/panels/ClarificationCard";
import { ReviewBar } from "@/components/panels/ReviewBar";
import { DesignChat } from "@/components/chat/DesignChat";
import { MiniMap } from "@/components/scene/MiniMap";

// R3F must run client-only.
const Scene3D = dynamic(
  () => import("@/components/scene/Scene3D").then((m) => m.Scene3D),
  { ssr: false }
);

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
  const phaseEvt = useEventsStore((s) => s.phase);
  const clearEvents = useEventsStore((s) => s.clear);

  React.useEffect(() => {
    setDesignId(designId);
    return () => {
      clearEvents();
      setDesign(undefined);
      setQuestions([]);
      setSelection({ kind: "none" });
      setFocusedCluster(undefined);
    };
  }, [designId, setDesignId, setDesign, setQuestions, setSelection, setFocusedCluster, clearEvents]);

  const { data: queryData, isLoading, error, refetch } = useQuery({
    queryKey: ["design", designId],
    queryFn: () => getDesign(designId),
    refetchOnWindowFocus: false,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return 2000;
      const p = (data as { phase?: string }).phase;
      return p && p !== "ready" && p !== "rejected" ? 2500 : false;
    }
  });

  // Push server state into Zustand whenever the query refreshes.
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

  if (isLoading && !design) {
    return (
      <div className="flex h-screen items-center justify-center text-muted">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading design...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center text-danger">
        Failed to load design: {String(error)}
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* 3D scene fills the whole viewport */}
      <div className="absolute inset-0">
        {design ? (
          <Scene3D
            design={design}
            layout={layout}
            selectedTable={selectedTableName}
            focusedCluster={focusedCluster}
            onSelectTable={(name) =>
              setSelection({ kind: "table", tableName: name })
            }
            onClearSelection={() => setSelection({ kind: "none" })}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Waiting for AI to generate the design...
          </div>
        )}
      </div>

      {/* Top header bar */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-4">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-surface/80 px-4 py-1.5 text-sm backdrop-blur">
          <Link href="/" className="text-muted hover:text-text">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Database className="h-4 w-4 text-accent" />
          <span className="font-medium">{design?.domain_analysis?.domain_guess || "Schema design"}</span>
          {design ? (
            <Badge variant="muted">
              {design.schema_designs.length} tables
            </Badge>
          ) : null}
          {phase ? (
            <Badge variant="accent">{phase}</Badge>
          ) : null}
          {design?.critique ? (
            <ConfidenceLegend issues={design.critique.issues} />
          ) : null}
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={handleRecritique}>
            <RefreshCw className="h-4 w-4" />
            Re-critique
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Left side: cluster filter */}
      {design && design.domain_analysis.clusters.length > 0 ? (
        <aside className="pointer-events-auto absolute left-4 top-1/2 z-10 max-h-[60vh] w-[220px] -translate-y-1/2 overflow-y-auto">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                <ListTree className="h-3.5 w-3.5 text-accent" />
                Clusters
              </div>
            </CardHeader>
            <CardBody className="flex flex-col gap-1">
              <button
                className="rounded-md px-2 py-1 text-left text-xs text-muted hover:bg-surfaceAlt"
                onClick={() => setFocusedCluster(undefined)}
              >
                All clusters
              </button>
              {design.domain_analysis.clusters.map((c) => (
                <button
                  key={c.cluster_id}
                  className={`rounded-md px-2 py-1 text-left text-xs hover:bg-surfaceAlt ${
                    focusedCluster === c.cluster_id ? "bg-accent/15 text-accent" : ""
                  }`}
                  onClick={() => setFocusedCluster(c.cluster_id)}
                  title={c.rationale}
                >
                  {c.name || c.cluster_id}{" "}
                  <span className="text-[10px] text-muted">
                    ({c.table_names.length})
                  </span>
                </button>
              ))}
            </CardBody>
          </Card>
        </aside>
      ) : null}

      {/* Top-right thinking stream */}
      <div className="pointer-events-auto absolute right-4 top-20 z-10">
        <AIThinkingStream />
      </div>

      {/* Bottom-right mini map */}
      {design ? (
        <div className="pointer-events-auto absolute bottom-4 right-4 z-10">
          <MiniMap
            layout={layout}
            selectedTable={selectedTableName}
            focusedCluster={focusedCluster}
          />
        </div>
      ) : null}

      {/* Bottom-left review + assumption stack */}
      <div className="pointer-events-auto absolute bottom-4 left-4 z-10 flex max-h-[70vh] w-[360px] flex-col gap-3 overflow-y-auto">
        {phase === "awaiting_clarification" && questions.length ? (
          <ClarificationCard
            designId={designId}
            questions={questions}
            round={round}
          />
        ) : null}
        <ReviewBar designId={designId} phase={phase} />
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
              <Network className="h-3.5 w-3.5 text-accent" />
              Pending revisions
            </div>
          </CardHeader>
          <CardBody>
            <DesignDiffPanel designId={designId} />
          </CardBody>
        </Card>
        <AssumptionDrawer
          domain={design?.domain_analysis}
          critique={design?.critique}
        />
      </div>

      {/* Right side inspector */}
      <Sheet
        open={selection.kind === "table"}
        onOpenChange={(o) => !o && setSelection({ kind: "none" })}
        title={
          selectedTable ? (
            <span className="flex items-center gap-2">
              <span>Table</span>
              <ChevronRight className="h-3 w-3 text-muted" />
              <code>{selectedTable.table_name}</code>
            </span>
          ) : (
            "Table"
          )
        }
      >
        {selectedTable ? (
          <TableInspector
            table={selectedTable}
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
      </Sheet>

      <Sheet
        open={selection.kind === "field"}
        onOpenChange={(o) =>
          !o &&
          setSelection(
            selectedTable
              ? { kind: "table", tableName: selectedTable.table_name }
              : { kind: "none" }
          )
        }
        title={
          selection.kind === "field" ? (
            <span className="flex items-center gap-2">
              <span>Field</span>
              <ChevronRight className="h-3 w-3 text-muted" />
              <code>
                {selection.tableName}.{selection.fieldName}
              </code>
            </span>
          ) : (
            "Field"
          )
        }
      >
        {selection.kind === "field" && selectedTable ? (
          <FieldInspector
            designId={designId}
            table={selectedTable}
            fieldName={selection.fieldName}
            initialState={selection.stateName}
          />
        ) : null}
      </Sheet>

      <DesignChat designId={designId} />
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
