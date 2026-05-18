"use client";

import * as React from "react";

interface ClusterHaloProps {
  center: [number, number, number];
  radius: number;
  color: string;
  active?: boolean;
}

export function ClusterHalo({
  center,
  radius,
  color,
  active = false
}: ClusterHaloProps) {
  const r = Math.max(radius * 1.4, 2);
  return (
    <mesh position={center}>
      <sphereGeometry args={[r, 24, 24]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={active ? 0.12 : 0.05}
        depthWrite={false}
      />
    </mesh>
  );
}
