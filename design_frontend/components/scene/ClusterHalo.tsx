"use client";

import * as React from "react";

interface ClusterHaloProps {
  center: [number, number, number];
  radius: number;
  color: string;
  active?: boolean;
  dimmed?: boolean;
}

export function ClusterHalo({
  center,
  radius,
  color,
  active = false,
  dimmed = false
}: ClusterHaloProps) {
  const r = Math.max(radius * 1.4, 2);
  const opacity = dimmed ? 0.02 : active ? 0.14 : 0.06;
  return (
    <mesh position={center}>
      <sphereGeometry args={[r, 24, 24]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </mesh>
  );
}
