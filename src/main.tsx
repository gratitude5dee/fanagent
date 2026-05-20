import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import App from "./App";
import "./styles.css";

const LibraryLanding = lazy(() => import("./pages/library/LibraryLanding"));
const LibraryDetail = lazy(() => import("./pages/library/LibraryDetail"));
const AccountsPage = lazy(() => import("./pages/settings/AccountsPage"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route
          path="/library"
          element={
            <Suspense fallback={<div className="lyrics-loading">Loading…</div>}>
              <LibraryLanding />
            </Suspense>
          }
        />
        <Route
          path="/library/:audioClipId"
          element={
            <Suspense fallback={<div className="lyrics-loading">Loading…</div>}>
              <LibraryDetail />
            </Suspense>
          }
        />
        <Route
          path="/settings/accounts"
          element={
            <Suspense fallback={<div className="lyrics-loading">Loading…</div>}>
              <AccountsPage />
            </Suspense>
          }
        />
        <Route path="/lyrics/*" element={<Navigate to="/?step=lyrics" replace />} />
        <Route path="/calendar" element={<Navigate to="/?mode=studio&view=calendar" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
