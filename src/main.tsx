import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import App from "./App";
import "./styles.css";

const LibraryLanding = lazy(() => import("./pages/library/LibraryLanding"));
const LibraryDetail = lazy(() => import("./pages/library/LibraryDetail"));
const ClipsPage = lazy(() => import("./pages/clips/ClipsPage"));
const AccountsPage = lazy(() => import("./pages/settings/AccountsPage"));
const LyricsHome = lazy(() => import("./pages/lyrics/LyricsHome"));
const LyricsWizard = lazy(() => import("./pages/lyrics/LyricsWizard"));
const RemixEditor = lazy(() => import("./pages/lyrics/RemixEditor"));
const RemixJobs = lazy(() => import("./pages/lyrics/RemixJobs"));

const wrap = (node: React.ReactNode) => (
  <Suspense fallback={<div className="lyrics-loading">Loading…</div>}>{node}</Suspense>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/library" element={wrap(<LibraryLanding />)} />
        <Route path="/clips" element={wrap(<ClipsPage />)} />
        <Route path="/library/:audioClipId" element={wrap(<LibraryDetail />)} />
        <Route path="/settings/accounts" element={wrap(<AccountsPage />)} />
        <Route path="/lyrics" element={wrap(<LyricsHome />)} />
        <Route path="/lyrics/new" element={wrap(<LyricsWizard />)} />
        <Route path="/lyrics/:templateId" element={wrap(<LyricsWizard />)} />
        <Route path="/lyrics/:templateId/remix" element={wrap(<RemixEditor />)} />
        <Route path="/lyrics/:templateId/jobs" element={wrap(<RemixJobs />)} />
        <Route path="/calendar" element={<Navigate to="/?mode=studio&view=calendar" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
