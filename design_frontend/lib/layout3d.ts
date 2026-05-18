import type { ERDLayout, FullDesign } from "./types";

/**
 * Fallback layout: cluster nodes on a ring around the origin if the backend
 * layout is missing. Pure-JS so it can run during SSR / before R3F mounts.
 */
export function fallbackLayout(design: FullDesign | undefined): ERDLayout {
  if (!design) return { tables: [], edges: [] };
  if (design.layout && design.layout.tables.length > 0) return design.layout;

  const clusters = design.domain_analysis?.clusters ?? [];
  const clusterCenters: Record<string, [number, number, number]> = {};
  const clusterIds = clusters.map((c) => c.cluster_id) ?? ["c0"];
  const bigR = Math.max(8, clusterIds.length * 2.5);
  clusterIds.forEach((cid, i) => {
    const theta = (2 * Math.PI * i) / Math.max(1, clusterIds.length);
    clusterCenters[cid] = [Math.cos(theta) * bigR, 0, Math.sin(theta) * bigR];
  });

  const memberOf: Record<string, string> = {};
  clusters.forEach((c) =>
    c.table_names.forEach((t) => {
      memberOf[t] = c.cluster_id;
    })
  );

  const tables = design.schema_designs.map((sd, idx) => {
    const cid = memberOf[sd.table_name] ?? clusterIds[0];
    const center = clusterCenters[cid] ?? [0, 0, 0];
    const n = clusters.find((c) => c.cluster_id === cid)?.table_names.length ?? 1;
    const phi = (2 * Math.PI * (idx % n)) / Math.max(1, n);
    const smallR = Math.max(1.5, n * 0.35);
    const [cx, cy, cz] = center;
    return {
      table_name: sd.table_name,
      cluster_id: cid,
      x: cx + Math.cos(phi) * smallR,
      y: cy + ((idx % 3) - 1) * 0.6,
      z: cz + Math.sin(phi) * smallR
    };
  });

  return { tables, edges: design.layout?.edges ?? [] };
}
