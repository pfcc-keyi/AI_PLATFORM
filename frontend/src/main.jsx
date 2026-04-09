import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App";
import ConfigPanel from "./pages/ConfigPanel";
import OpsPanel from "./pages/OpsPanel";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Navigate to="/config" replace />} />
          <Route path="config" element={<ConfigPanel />} />
          <Route path="ops" element={<OpsPanel />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
