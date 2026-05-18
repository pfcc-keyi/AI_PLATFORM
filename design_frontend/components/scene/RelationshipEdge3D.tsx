"use client";

import * as React from "react";
import { CatmullRomCurve3, Vector3, TubeGeometry } from "three";
import { useFrame } from "@react-three/fiber";

interface RelationshipEdge3DProps {
  from: [number, number, number];
  to: [number, number, number];
  color: string;
  dimmed?: boolean;
}

function buildCurve(
  from: [number, number, number],
  to: [number, number, number]
): CatmullRomCurve3 {
  const a = new Vector3(...from);
  const b = new Vector3(...to);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const arc = mid
    .clone()
    .add(new Vector3(0, 1.4 + a.distanceTo(b) * 0.1, 0));
  return new CatmullRomCurve3([a, arc, b]);
}

export function RelationshipEdge3D({
  from,
  to,
  color,
  dimmed = false
}: RelationshipEdge3DProps) {
  const curve = React.useMemo(() => buildCurve(from, to), [from, to]);
  const geometry = React.useMemo(
    () => new TubeGeometry(curve, 32, 0.025, 6, false),
    [curve]
  );
  const matRef = React.useRef<any>(null);

  useFrame((state) => {
    if (matRef.current) {
      const t = state.clock.elapsedTime;
      matRef.current.opacity = (dimmed ? 0.06 : 0.5) + Math.sin(t * 2) * 0.05;
    }
  });

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial
        ref={matRef}
        color={color}
        transparent
        opacity={dimmed ? 0.1 : 0.6}
        depthWrite={false}
      />
    </mesh>
  );
}
