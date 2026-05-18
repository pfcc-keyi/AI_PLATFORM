"use client";

import * as React from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls, Stars } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { ClusterHalo } from "./ClusterHalo";
import { RelationshipEdge3D } from "./RelationshipEdge3D";
import { TableNode3D } from "./TableNode3D";
import type { ERDLayout, FullDesign, SchemaDesign } from "@/lib/types";

interface Scene3DProps {
  design: FullDesign;
  layout: ERDLayout;
  selectedTable?: string;
  focusedCluster?: string;
  onSelectTable: (tableName: string) => void;
  onClearSelection: () => void;
}

const CLUSTER_PALETTE = [
  "#a877ff", // accent
  "#4fd1ff", // accent alt
  "#5cdaa2", // success
  "#fcc46e", // warning
  "#f6607a", // danger
  "#7c5cff",
  "#36c2ff",
  "#ff8bd0",
  "#9eff7c",
  "#ffd178"
];

function clusterColor(clusterId: string | undefined, idx: number): string {
  const i = idx % CLUSTER_PALETTE.length;
  return CLUSTER_PALETTE[i];
}

export function Scene3D({
  design,
  layout,
  selectedTable,
  focusedCluster,
  onSelectTable,
  onClearSelection
}: Scene3DProps) {
  const positions: Record<string, [number, number, number]> = React.useMemo(() => {
    const out: Record<string, [number, number, number]> = {};
    for (const t of layout.tables) {
      out[t.table_name] = [t.x, t.y, t.z];
    }
    return out;
  }, [layout]);

  const clusterCenters: Record<
    string,
    { center: [number, number, number]; radius: number }
  > = React.useMemo(() => {
    const map: Record<string, [number, number, number][]> = {};
    for (const t of layout.tables) {
      const cid = t.cluster_id || "c0";
      if (!map[cid]) map[cid] = [];
      map[cid].push([t.x, t.y, t.z]);
    }
    const out: Record<string, { center: [number, number, number]; radius: number }> = {};
    for (const cid of Object.keys(map)) {
      const pts = map[cid];
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      const cz = pts.reduce((s, p) => s + p[2], 0) / pts.length;
      const radius = Math.max(
        1.5,
        Math.max(
          ...pts.map((p) =>
            Math.sqrt((p[0] - cx) ** 2 + (p[1] - cy) ** 2 + (p[2] - cz) ** 2)
          )
        )
      );
      out[cid] = { center: [cx, cy, cz], radius };
    }
    return out;
  }, [layout]);

  const clusterColorMap: Record<string, string> = React.useMemo(() => {
    const ids = Object.keys(clusterCenters);
    const out: Record<string, string> = {};
    ids.forEach((id, i) => {
      out[id] = clusterColor(id, i);
    });
    return out;
  }, [clusterCenters]);

  const tablesByName: Record<string, SchemaDesign> = React.useMemo(() => {
    const out: Record<string, SchemaDesign> = {};
    for (const sd of design.schema_designs) {
      out[sd.table_name] = sd;
    }
    return out;
  }, [design.schema_designs]);

  const tableClusterOf: Record<string, string> = React.useMemo(() => {
    const out: Record<string, string> = {};
    for (const t of layout.tables) {
      if (t.cluster_id) out[t.table_name] = t.cluster_id;
    }
    return out;
  }, [layout.tables]);

  const neighbours = React.useMemo(() => {
    if (!selectedTable) return new Set<string>();
    const s = new Set<string>();
    for (const e of layout.edges) {
      if (e.from_table === selectedTable && e.to_table) s.add(e.to_table);
      if (e.to_table === selectedTable && e.from_table) s.add(e.from_table);
    }
    return s;
  }, [layout.edges, selectedTable]);

  function isDimmed(tableName: string): boolean {
    if (selectedTable) {
      return tableName !== selectedTable && !neighbours.has(tableName);
    }
    if (focusedCluster) {
      return tableClusterOf[tableName] !== focusedCluster;
    }
    return false;
  }

  return (
    <Canvas
      camera={{ position: [0, 8, 24], fov: 50 }}
      dpr={[1, 2]}
      onPointerMissed={onClearSelection}
    >
      <color attach="background" args={["#0b0d14"]} />
      <ambientLight intensity={0.3} />
      <pointLight position={[10, 10, 10]} intensity={0.8} />
      <pointLight position={[-10, -10, -10]} intensity={0.4} color="#4fd1ff" />
      <Stars
        radius={120}
        depth={60}
        count={2200}
        factor={3}
        saturation={0}
        fade
        speed={0.4}
      />
      <Environment preset="night" />

      {Object.entries(clusterCenters).map(([cid, info]) => (
        <ClusterHalo
          key={cid}
          center={info.center}
          radius={info.radius}
          color={clusterColorMap[cid]}
          active={focusedCluster === cid}
        />
      ))}

      {layout.edges.map((edge, i) => {
        const from = positions[edge.from_table];
        const to = positions[edge.to_table];
        if (!from || !to) return null;
        const dimmed =
          (selectedTable &&
            edge.from_table !== selectedTable &&
            edge.to_table !== selectedTable) ||
          (focusedCluster &&
            tableClusterOf[edge.from_table] !== focusedCluster &&
            tableClusterOf[edge.to_table] !== focusedCluster);
        const cid = tableClusterOf[edge.from_table];
        return (
          <RelationshipEdge3D
            key={`${edge.from_table}-${edge.to_table}-${i}`}
            from={from}
            to={to}
            color={clusterColorMap[cid] || "#a877ff"}
            dimmed={Boolean(dimmed)}
          />
        );
      })}

      {layout.tables.map((t) => {
        const table = tablesByName[t.table_name];
        if (!table) return null;
        const cid = t.cluster_id || "c0";
        return (
          <TableNode3D
            key={t.table_name}
            table={table}
            position={[t.x, t.y, t.z]}
            color={clusterColorMap[cid] || "#a877ff"}
            selected={selectedTable === t.table_name}
            dimmed={isDimmed(t.table_name)}
            onSelect={() => onSelectTable(t.table_name)}
          />
        );
      })}

      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        autoRotate={!selectedTable && !focusedCluster}
        autoRotateSpeed={0.2}
        makeDefault
      />
      <EffectComposer>
        <Bloom intensity={0.85} luminanceThreshold={0.2} mipmapBlur />
      </EffectComposer>
    </Canvas>
  );
}
