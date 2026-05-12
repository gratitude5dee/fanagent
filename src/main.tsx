import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import App from "./App";
import "./styles.css";

const LyricsLanding = lazy(() => import("./pages/lyrics/LyricsLanding"));
const LyricsWizard = lazy(() => import("./pages/lyrics/LyricsWizard"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route
          path="/lyrics"
          element={
            <Suspense fallback={<div className="lyrics-loading">Loading…</div>}>
              <LyricsLanding />
            </Suspense>
          }
        />
        <Route
          path="/lyrics/new"
          element={
            <Suspense fallback={<div className="lyrics-loading">Loading…</div>}>
              <LyricsWizard />
            </Suspense>
          }
        />
        <Route
          path="/lyrics/templates/:templateId"
          element={
            <Suspense fallback={<div className="lyrics-loading">Loading…</div>}>
              <LyricsWizard />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
