import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import App from "./App";
import { AppShell } from "./components/AppShell";
import "./styles.css";

const LibraryLanding = lazy(() => import("./pages/library/LibraryLanding"));
const LibraryDetail = lazy(() => import("./pages/library/LibraryDetail"));
const ClipsPage = lazy(() => import("./pages/clips/ClipsPage"));
const AccountsPage = lazy(() => import("./pages/settings/AccountsPage"));
const LyricsHome = lazy(() => import("./pages/lyrics/LyricsHome"));
const LyricsWizard = lazy(() => import("./pages/lyrics/LyricsWizard"));
const RemixEditor = lazy(() => import("./pages/lyrics/RemixEditor"));
const RemixJobs = lazy(() => import("./pages/lyrics/RemixJobs"));
const AutopilotLayout = lazy(() => import("./pages/autopilot/AutopilotLayout"));
const ConnectPage = lazy(() => import("./pages/autopilot/steps/ConnectPage"));
const UploadPage = lazy(() => import("./pages/autopilot/steps/UploadPage"));
const AutopilotLyricsPage = lazy(() => import("./pages/autopilot/steps/LyricsPage"));
const CampaignPage = lazy(() => import("./pages/autopilot/steps/CampaignPage"));
const ReviewPage = lazy(() => import("./pages/autopilot/steps/ReviewPage"));
const CampaignsPage = lazy(() => import("./pages/campaigns/CampaignsPage"));
const CampaignDetailPage = lazy(() => import("./pages/campaigns/CampaignDetailPage"));

const wrap = (node: React.ReactNode) => (
  <AppShell>
    <Suspense fallback={<div className="lyrics-loading">Loading…</div>}>{node}</Suspense>
  </AppShell>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <AppShell>
              <App />
            </AppShell>
          }
        />
        <Route path="/library" element={wrap(<LibraryLanding />)} />
        <Route path="/clips" element={wrap(<ClipsPage />)} />
        <Route path="/library/:audioClipId" element={wrap(<LibraryDetail />)} />
        <Route path="/settings/accounts" element={wrap(<AccountsPage />)} />
        <Route path="/lyrics" element={wrap(<LyricsHome />)} />
        <Route path="/lyrics/new" element={wrap(<LyricsWizard />)} />
        <Route path="/lyrics/:templateId" element={wrap(<LyricsWizard />)} />
        <Route path="/lyrics/:templateId/remix" element={wrap(<RemixEditor />)} />
        <Route path="/lyrics/:templateId/jobs" element={wrap(<RemixJobs />)} />
        <Route path="/autopilot" element={wrap(<AutopilotLayout />)}>
          <Route index element={<Navigate to="connect" replace />} />
          <Route path="connect" element={<ConnectPage />} />
          <Route path="upload" element={<UploadPage />} />
          <Route path="lyrics" element={<AutopilotLyricsPage />} />
          <Route path="campaign" element={<CampaignPage />} />
          <Route path="review" element={<ReviewPage />} />
        </Route>
        <Route path="/campaigns" element={wrap(<CampaignsPage />)} />
        <Route path="/campaigns/:batchId" element={wrap(<CampaignDetailPage />)} />
        <Route path="/calendar" element={<Navigate to="/?mode=studio&view=calendar" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
