import React from "react";
import { NavLink, Outlet } from "react-router-dom";

const navStyle = {
  display: "flex",
  gap: "1rem",
  flexWrap: "wrap",
  alignItems: "center",
  padding: "1rem clamp(1rem, 3vw, 2rem)",
  borderBottom: "1px solid #222",
  background: "#111",
};

const linkBase = {
  color: "#999",
  textDecoration: "none",
  padding: "0.5rem 1rem",
  borderRadius: "6px",
  fontSize: "0.9rem",
  fontWeight: 500,
  transition: "all 0.15s",
};

export default function App() {
  return (
    <div>
      <nav style={navStyle}>
        <span style={{ color: "#fff", fontWeight: 700, marginRight: "2rem" }}>
          AI Platform
        </span>
        <NavLink
          to="/config"
          style={({ isActive }) => ({
            ...linkBase,
            color: isActive ? "#fff" : "#999",
            background: isActive ? "#333" : "transparent",
          })}
        >
          Config Panel
        </NavLink>
        <NavLink
          to="/ops"
          style={({ isActive }) => ({
            ...linkBase,
            color: isActive ? "#fff" : "#999",
            background: isActive ? "#333" : "transparent",
          })}
        >
          Operations Panel
        </NavLink>
      </nav>
      <main style={{ padding: "clamp(1rem, 3vw, 2rem)" }}>
        <Outlet />
      </main>
    </div>
  );
}
