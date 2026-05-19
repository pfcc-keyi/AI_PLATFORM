"use client";

import * as React from "react";
import { CatmullRomCurve3, Vector3, TubeGeometry, ConeGeometry } from "three";
import { useFrame } from "@react-three/fiber";

interface RelationshipEdge3DProps {
  from: [number, number, number];
  to: [number, number, number];
  color: string;
  dimmed?: boolean;
  /** When true, this edge is one of the selected table's relationships and
   * deserves a thicker tube + arrowhead + slightly faster pulse. */
  highlighted?: boolean;
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
    .add(new Vector3(0, 1.4 + a.distanceTo(b) * 0.08, 0));
  return new CatmullRomCurve3([a, arc, b]);
}

export function RelationshipEdge3D({
  from,
  to,
  color,
  dimmed = false,
  highlighted = false
}: RelationshipEdge3DProps) {
  const curve = React.useMemo(() => buildCurve(from, to), [from, to]);
  const radius = highlighted ? 0.07 : 0.025;
  const geometry = React.useMemo(
    () => new TubeGeometry(curve, 48, radius, 8, false),
    [curve, radius]
  );
  const matRef = React.useRef<any>(null);
  const arrowRef = React.useRef<any>(null);

  // Compute the arrow placement near the end of the curve; reused each render.
  const arrowData = React.useMemo(() => {
    const end = curve.getPoint(0.92);
    const tan = curve.getTangent(1).normalize();
    // ConeGeometry points along +Y by default; rotate so it lies along `tan`.
    const lookAt = end.clone().add(tan);
    return { position: end.toArray() as [number, number, number], lookAt };
  }, [curve]);

  useFrame((state) => {
    if (matRef.current) {
      const t = state.clock.elapsedTime;
      const base = highlighted ? 0.95 : dimmed ? 0.08 : 0.5;
      const pulse = highlighted ? Math.sin(t * 3) * 0.08 : Math.sin(t * 1.5) * 0.04;
      matRef.current.opacity = base + pulse;
    }
    if (arrowRef.current) {
      arrowRef.current.lookAt(arrowData.lookAt);
    }
  });

  return (
    <group>
      <mesh geometry={geometry}>
        <meshBasicMaterial
          ref={matRef}
          color={color}
          transparent
          opacity={dimmed ? 0.1 : highlighted ? 0.95 : 0.6}
          depthWrite={false}
        />
      </mesh>
      {highlighted ? (
        <mesh
          ref={arrowRef}
          position={arrowData.position}
          // ConeGeometry's axis is +Y; rotate -90deg around X so lookAt(z) works
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <coneGeometry args={[0.22, 0.55, 12]} />
          <meshBasicMaterial color={color} transparent opacity={0.95} />
        </mesh>
      ) : null}
    </group>
  );
}
