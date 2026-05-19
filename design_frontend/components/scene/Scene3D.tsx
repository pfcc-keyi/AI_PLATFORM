"use client";

import * as React from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import type {
  OrbitControls as OrbitControlsImpl
} from "three-stdlib";
import type { PerspectiveCamera } from "three";
import { Vector3 } from "three";
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
  /** Bumped by parent to ask the camera to recompute its framing. */
  focusToken?: number;
  /** Imperative request to reset the camera to the home pose. */
  resetToken?: number;
}

const CLUSTER_PALETTE = [
  "#a877ff",
  "#4fd1ff",
  "#5cdaa2",
  "#fcc46e",
  "#f6607a",
  "#7c5cff",
  "#36c2ff",
  "#ff8bd0",
  "#9eff7c",
  "#ffd178"
];

function clusterColor(_clusterId: string | undefined, idx: number): string {
  const i = idx % CLUSTER_PALETTE.length;
  return CLUSTER_PALETTE[i];
}

/**
 * Smoothly lerps the camera position + orbit target toward a new framing.
 *
 * - On `selectedTable` change: zoom in on the table, keep current viewing
 *   angle but pull closer.
 * - On `focusedCluster` change: frame the whole cluster, pulling back enough
 *   for the bounding sphere to fit.
 * - On `resetToken` change: snap (via lerp) back to the wide home pose so the
 *   whole graph is visible.
 *
 * Uses requestAnimationFrame loop locally instead of useFrame so we can
 * register the animation only when needed and stop once the camera arrives.
 */
function CameraController({
  selectedTable,
  focusedCluster,
  positions,
  clusterCenters,
  resetToken,
  focusToken
}: {
  selectedTable?: string;
  focusedCluster?: string;
  positions: Record<string, [number, number, number]>;
  clusterCenters: Record<
    string,
    { center: [number, number, number]; radius: number }
  >;
  resetToken?: number;
  focusToken?: number;
}) {
  const { camera, controls } = useThree() as unknown as {
    camera: PerspectiveCamera;
    controls: OrbitControlsImpl | null;
  };

  const targetPos = React.useRef(new Vector3());
  const targetLook = React.useRef(new Vector3());
  const tweening = React.useRef(false);
  const homePose = React.useMemo(
    () => ({ pos: new Vector3(0, 8, 24), look: new Vector3(0, 0, 0) }),
    []
  );

  React.useEffect(() => {
    // Decide the next target framing whenever inputs change.
    let pos = homePose.pos.clone();
    let look = homePose.look.clone();

    if (selectedTable && positions[selectedTable]) {
      const [tx, ty, tz] = positions[selectedTable];
      look.set(tx, ty, tz);
      // Approach from the camera's current direction so users don't get
      // disoriented; just move closer along that vector.
      const dir = new Vector3()
        .subVectors(camera.position, look)
        .normalize()
        .multiplyScalar(6.5); // distance from the node
      pos.copy(look).add(dir);
    } else if (focusedCluster && clusterCenters[focusedCluster]) {
      const c = clusterCenters[focusedCluster];
      look.set(c.center[0], c.center[1], c.center[2]);
      const dist = Math.max(10, c.radius * 4.2);
      const dir = new Vector3()
        .subVectors(camera.position, look)
        .normalize()
        .multiplyScalar(dist);
      pos.copy(look).add(dir);
    }

    targetPos.current.copy(pos);
    targetLook.current.copy(look);
    tweening.current = true;
    // we don't depend on `camera` so resets/focuses don't re-arm constantly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTable, focusedCluster, resetToken, focusToken]);

  React.useEffect(() => {
    let raf = 0;
    function tick() {
      if (tweening.current) {
        // Smoothly approach the targets.
        camera.position.lerp(targetPos.current, 0.12);
        if (controls) {
          (controls.target as Vector3).lerp(targetLook.current, 0.14);
          controls.update();
        }
        const posDelta = camera.position.distanceTo(targetPos.current);
        const lookDelta = controls
          ? (controls.target as Vector3).distanceTo(targetLook.current)
          : 0;
        if (posDelta < 0.05 && lookDelta < 0.05) {
          tweening.current = false;
        }
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [camera, controls]);

  return null;
}

export function Scene3D({
  design,
  layout,
  selectedTable,
  focusedCluster,
  onSelectTable,
  onClearSelection,
  focusToken,
  resetToken
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
    <SceneErrorBoundary>
      <Canvas
        // Explicit GL options avoid "Cannot read properties of null (reading
        // 'alpha')" crashes in @react-three/postprocessing v3 when the WebGL
        // context isn't fully initialized at first paint.
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
          stencil: false,
          depth: true
        }}
        camera={{ position: [0, 8, 24], fov: 50, near: 0.1, far: 400 }}
        dpr={[1, 2]}
        onPointerMissed={onClearSelection}
      >
        <color attach="background" args={["#0b0d14"]} />
        <fog attach="fog" args={["#0b0d14", 36, 110]} />
        <ambientLight intensity={0.35} />
        <pointLight position={[10, 14, 10]} intensity={0.8} />
        <pointLight position={[-12, -8, -12]} intensity={0.45} color="#4fd1ff" />
        <React.Suspense fallback={null}>
          <Stars
            radius={140}
            depth={70}
            count={1800}
            factor={3}
            saturation={0}
            fade
            speed={0.35}
          />
        </React.Suspense>

        {Object.entries(clusterCenters).map(([cid, info]) => (
          <ClusterHalo
            key={cid}
            center={info.center}
            radius={info.radius}
            color={clusterColorMap[cid]}
            active={focusedCluster === cid}
            dimmed={
              Boolean(focusedCluster && focusedCluster !== cid) ||
              Boolean(selectedTable && tableClusterOf[selectedTable] !== cid)
            }
          />
        ))}

        {layout.edges.map((edge, i) => {
          const from = positions[edge.from_table];
          const to = positions[edge.to_table];
          if (!from || !to) return null;
          const highlighted = Boolean(
            selectedTable &&
              (edge.from_table === selectedTable ||
                edge.to_table === selectedTable)
          );
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
              highlighted={highlighted}
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
          enableDamping
          dampingFactor={0.12}
          minDistance={2}
          maxDistance={120}
          makeDefault
        />
        <CameraController
          selectedTable={selectedTable}
          focusedCluster={focusedCluster}
          positions={positions}
          clusterCenters={clusterCenters}
          resetToken={resetToken}
          focusToken={focusToken}
        />
        <React.Suspense fallback={null}>
          <EffectComposer multisampling={0}>
            <Bloom intensity={0.85} luminanceThreshold={0.2} mipmapBlur />
          </EffectComposer>
        </React.Suspense>
      </Canvas>
    </SceneErrorBoundary>
  );
}

class SceneErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: unknown }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, error };
  }
  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.warn("Scene3D crashed:", error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted">
          <div className="text-sm">3D scene failed to render.</div>
          <button
            className="rounded-full border border-border bg-surface/80 px-3 py-1 text-xs hover:bg-surfaceAlt"
            onClick={() => this.setState({ hasError: false, error: undefined })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
