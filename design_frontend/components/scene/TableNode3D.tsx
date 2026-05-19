"use client";

import * as React from "react";
import { Billboard, Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh } from "three";
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
  const ringRef = React.useRef<Mesh>(null);
  const [hover, setHover] = React.useState(false);

  useFrame((state, dt) => {
    const g = groupRef.current;
    if (!g) return;
    const targetScale = selected ? 1.35 : hover ? 1.15 : 1;
    tmpVec.set(targetScale, targetScale, targetScale);
    g.scale.lerp(tmpVec, 0.18);

    // Selected node spins its ring (not the core) for a clear "focus" cue
    // without making the whole layout feel chaotic.
    if (ringRef.current && selected) {
      ringRef.current.rotation.z += dt * 1.5;
      ringRef.current.rotation.x = Math.sin(state.clock.elapsedTime) * 0.4;
    }
  });

  // Dimming has to leave the selected node bright even if its own "dimmed"
  // flag is wrong.
  const opacity = dimmed && !selected ? 0.25 : 1;
  const labelOpacity = dimmed && !selected ? 0.45 : 1;
  // Hide labels of dimmed nodes entirely — they clutter the view when
  // zoomed in on a single table and overlap with page chrome.
  const showLabel = !dimmed || selected || hover;

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
        setHover(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = "";
      }}
    >
      {/* Core orb */}
      <mesh>
        <icosahedronGeometry args={[0.55, 1]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 1.6 : hover ? 0.9 : 0.55}
          metalness={0.45}
          roughness={0.25}
          transparent
          opacity={opacity}
        />
      </mesh>

      {/* Selection ring — only when selected, rotates slowly */}
      {selected ? (
        <mesh ref={ringRef}>
          <torusGeometry args={[1.05, 0.04, 12, 64]} />
          <meshBasicMaterial color={color} transparent opacity={0.75} />
        </mesh>
      ) : null}

      {/* Hover halo — quick feedback when pointer is on the node */}
      {hover && !selected ? (
        <mesh>
          <icosahedronGeometry args={[0.82, 1]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.35} />
        </mesh>
      ) : null}

      {showLabel ? (
        <Billboard position={[0, 1.05, 0]}>
          {/*
            distanceFactor 9 keeps the label readable from a sensible
            distance. zIndexRange forces labels to live BELOW the page
            chrome (top bar = z-20 in CSS).
          */}
          <Html
            center
            distanceFactor={9}
            occlude={false}
            zIndexRange={[1, 5]}
            style={{ pointerEvents: "none" }}
          >
            <div
              className="select-none whitespace-nowrap rounded-md border bg-surface/95 px-2 py-0.5 text-[11px] font-medium tracking-tight"
              style={{
                opacity: labelOpacity,
                color: "rgb(232 234 240)",
                borderColor: selected ? color : "rgb(38 45 65)",
                boxShadow: selected
                  ? `0 0 16px -2px ${color}`
                  : hover
                    ? `0 0 8px -2px ${color}`
                    : "none"
              }}
            >
              {table.table_name}
            </div>
          </Html>
        </Billboard>
      ) : null}
    </group>
  );
}
