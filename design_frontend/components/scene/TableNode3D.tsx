"use client";

import * as React from "react";
import { Billboard, Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { Vector3 } from "three";
import type { SchemaDesign } from "@/lib/types";

interface TableNode3DProps {
  table: SchemaDesign;
  position: [number, number, number];
  color: string;
  selected?: boolean;
  dimmed?: boolean;
  onSelect?: () => void;
}

const tmpVec = new Vector3();

export function TableNode3D({
  table,
  position,
  color,
  selected = false,
  dimmed = false,
  onSelect
}: TableNode3DProps) {
  const groupRef = React.useRef<Group>(null);
  const hover = React.useRef(false);

  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;
    // Subtle hover / breathing motion
    g.rotation.y += dt * 0.15;
    const targetScale = selected ? 1.25 : hover.current ? 1.12 : 1;
    tmpVec.set(targetScale, targetScale, targetScale);
    g.scale.lerp(tmpVec, 0.1);
  });

  const opacity = dimmed && !selected ? 0.25 : 1;

  return (
    <group
      ref={groupRef}
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        hover.current = true;
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        hover.current = false;
        document.body.style.cursor = "";
      }}
    >
      {/* Glowing core */}
      <mesh>
        <icosahedronGeometry args={[0.55, 1]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 1.4 : 0.55}
          metalness={0.4}
          roughness={0.25}
          transparent
          opacity={opacity}
        />
      </mesh>
      {/* Outer wireframe halo when selected */}
      {selected ? (
        <mesh>
          <icosahedronGeometry args={[0.85, 1]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.45} />
        </mesh>
      ) : null}

      <Billboard position={[0, 1.05, 0]}>
        <Html center distanceFactor={9} occlude={false}>
          <div
            className="pointer-events-none select-none whitespace-nowrap rounded-md border border-border bg-surface/90 px-2 py-0.5 text-[11px] font-medium text-text shadow-glow"
            style={{ opacity }}
          >
            {table.table_name}
          </div>
        </Html>
      </Billboard>
    </group>
  );
}
