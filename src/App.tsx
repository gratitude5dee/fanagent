import { useEffect, useMemo, useRef, useState } from "react";
import type { EventDropArg } from "@fullcalendar/core";
import {
  CalendarDays,
  Images,
  PlugZap,
  RefreshCcw,
  Send,
  Sparkles,
  UploadCloud,
  WandSparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import AutopilotPanel from "@/components/AutopilotPanel";
import AutopilotWizard from "@/components/AutopilotWizard";
import BulkScheduleDialog from "@/components/calendar/BulkScheduleDialog";
import StudioCalendarPanel from "@/components/studio/StudioCalendarPanel";
import StudioPostReview from "@/components/studio/StudioPostReview";
import StudioReadyLibraryPanel from "@/components/studio/StudioReadyLibraryPanel";
import { SUPABASE_URL } from "@/integrations/supabase/client";
import {
  buildTikTokPrivacySettings,
  filterCalendarLibraryItems,
  isCreatorCommentDisabled,
  isPastScheduleDrop,
  toLocalInputValue,
  type CalendarFilters,
  type CalendarView,
} from "@/lib/calendar/posts";
import { buildTikTokConnectUrl } from "@/lib/fanagent/accounts";
import { invokeEdgeFunction } from "@/lib/fanagent/invokeFunction";
import type { SourceMode } from "@/lib/fanagent/types";
import { scheduleLibraryItems } from "@/lib/library/api";
import { readInitialAppQuery } from "@/lib/studio/initialAppQuery";
import { useStudioData } from "@/lib/studio/useStudioData";

function statusClass(status: string): string {
  if (status === "posted" || status === "complete") return "good";
  if (status === "failed" || status === "partial") return "bad";
  if (status === "posting" || status === "generating" || status === "rendering") return "warn";
  return "idle";
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);

  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary);
}

async function invokeFunction<T>(name: string, body?: Record<string, unknown>): Promise<T> {
  return invokeEdgeFunction<T>(name, body);
}

export default function App() {
  const initialQuery = useRef(readInitialAppQuery());
  const { data, refresh, busy: studioBusy, error: studioError } = useStudioData();
  const libraryPanelRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"autopilot" | "studio">(initialQuery.current.mode);
  const [studioView, setStudioView] = useState<"create" | "calendar">(
    initialQuery.current.studioView,
  );
  const [accountId, setAccountId] = useState("");
  const [audio, setAudio] = useState<File | null>(null);
  const [count, setCount] = useState(6);
  const [sourceMode, setSourceMode] = useState<SourceMode>("stock");
  const [prompt, setPrompt] = useState("cinematic fan edit synced to the uploaded audio");
  const [startAt, setStartAt] = useState(() =>
    toLocalInputValue(new Date(Date.now() + 30 * 60_000)),
  );
  const [cadence, setCadence] = useState(240);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<Set<string>>(() => new Set());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [readyLibraryOpen, setReadyLibraryOpen] = useState(false);
  const [calendarView, setCalendarView] = useState<CalendarView>("week");
  const [filters, setFilters] = useState<CalendarFilters>({
    accountId: "",
    audioClipId: "",
    status: "all",
  });
  const [actionBusy, setActionBusy] = useState(false);
  const [lyricsFocusSignal, setLyricsFocusSignal] = useState(
    initialQuery.current.focusLyrics ? 1 : 0,
  );

  const selectedAccount = data.accounts.find((account) => account.id === accountId) ?? null;
  const selectedPost = data.posts.find((post) => post.id === selectedPostId) ?? null;
  const previewById = useMemo(
    () => new Map(data.libraryPreviews.map((preview) => [preview.id, preview])),
    [data.libraryPreviews],
  );
  const accountById = useMemo(
    () => new Map(data.accounts.map((account) => [account.id, account])),
    [data.accounts],
  );
  const selectedPreview = selectedPost?.library_item_id
    ? (previewById.get(selectedPost.library_item_id) ?? null)
    : null;
  const selectedPostAccount = selectedPost
    ? (accountById.get(selectedPost.account_id) ?? null)
    : null;
  const filteredLibraryItems = useMemo(
    () => filterCalendarLibraryItems(data.libraryItems, filters),
    [data.libraryItems, filters],
  );
  const blockedPostCount = data.posts.filter((post) =>
    post.publish_status?.startsWith("blocked_"),
  ).length;
  const audioClipIds = useMemo(
    () =>
      Array.from(
        new Set([
          ...data.libraryPreviews.map((preview) => preview.audio_clip_id),
          ...data.libraryItems.map((item) => item.audio_clip_id),
        ]),
      ).sort(),
    [data.libraryItems, data.libraryPreviews],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const modeParam = params.get("mode");
    const viewParam = params.get("view");
    const stepParam = params.get("step");
    if (!modeParam && !viewParam && !stepParam) return;

    if (stepParam === "lyrics") {
      setMode("autopilot");
      setLyricsFocusSignal(Date.now());
    } else {
      if (modeParam === "autopilot" || modeParam === "studio") {
        setMode(modeParam);
      }
      if (modeParam === "studio" && (viewParam === "create" || viewParam === "calendar")) {
        setStudioView(viewParam);
      }
    }
    window.history.replaceState(null, "", window.location.pathname || "/");
  }, []);

  useEffect(() => {
    setAccountId((current) => {
      if (current && data.accounts.some((account) => account.id === current)) return current;
      return data.accounts[0]?.id ?? "";
    });
  }, [data.accounts]);

  useEffect(() => {
    setSelectedPostId((current) => {
      if (current && data.posts.some((post) => post.id === current)) return current;
      return data.posts[0]?.id ?? null;
    });
  }, [data.posts]);

  useEffect(() => {
    const visibleIds = new Set(filteredLibraryItems.map((item) => item.id));
    setSelectedLibraryIds((current) => {
      const next = new Set(Array.from(current).filter((itemId) => visibleIds.has(itemId)));
      return next.size === current.size ? current : next;
    });
  }, [filteredLibraryItems]);

  async function runAction(label: string, action: () => Promise<unknown>) {
    setActionBusy(true);
    setMessage(null);
    try {
      await action();
      await refresh();
      setMessage(`${label} complete.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function createBatch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!audio) throw new Error("Choose an audio file first.");
    if (!accountId)
      throw new Error("Create or select a TikTok account before queueing generation.");
    if (audio.size > 12 * 1024 * 1024)
      throw new Error("Audio uploads are limited to 12MB in hosted v1.");

    await invokeFunction("fanpage-campaign", {
      action: "create",
      accountId,
      audioBase64: await fileToBase64(audio),
      audioMimeType: audio.type || "audio/mpeg",
      audioFileName: audio.name || "audio-upload",
      count,
      sourceMode,
      prompt,
      startAt: new Date(startAt).toISOString(),
      cadenceMinutes: cadence,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }

  async function updatePostSchedule(arg: EventDropArg) {
    const droppedAt = arg.event.start;
    if (!droppedAt) return;
    if (isPastScheduleDrop(droppedAt)) {
      arg.revert();
      setMessage("Cannot reschedule into the past.");
      return;
    }

    setActionBusy(true);
    setMessage(null);
    try {
      await invokeFunction("update-post-schedule", {
        postId: arg.event.id,
        scheduledAt: droppedAt.toISOString(),
      });
      await refresh();
      setMessage("Schedule update complete.");
    } catch (error) {
      arg.revert();
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function scheduleDrop(libraryItemId: string, scheduledAt: Date) {
    if (isPastScheduleDrop(scheduledAt)) {
      setMessage("Cannot reschedule into the past.");
      return;
    }
    setActionBusy(true);
    setMessage(null);
    try {
      await scheduleLibraryItems([{ libraryItemId, scheduledAt: scheduledAt.toISOString() }]);
      setSelectedLibraryIds(new Set());
      await refresh();
      setMessage("Library item scheduled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      await refresh();
    } finally {
      setActionBusy(false);
    }
  }

  function toggleLibraryItem(itemId: string) {
    setSelectedLibraryIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  async function saveSelectedPost(form: HTMLFormElement) {
    if (!selectedPost) return;
    const creatorInfo = selectedPostAccount?.tiktok_creator_info ?? null;
    const commentLocked = isCreatorCommentDisabled(creatorInfo);
    const formData = new FormData(form);
    const hashtags = String(formData.get("hashtags") || "")
      .split(/\s+/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    const privacyLevel = String(formData.get("privacyLevel") || "") || null;
    const disableDuet = formData.get("disableDuet") === "on";
    const disableStitch = formData.get("disableStitch") === "on";
    const disableComment = commentLocked || formData.get("disableComment") === "on";
    const isAigc = formData.get("isAigc") === "on";
    const brandContentToggle = formData.get("brandContentToggle") === "on";
    const brandOrganicToggle = formData.get("brandOrganicToggle") === "on";

    setActionBusy(true);
    setMessage(null);
    try {
      await invokeFunction("update-post-schedule", {
        postId: selectedPost.id,
        scheduledAt: new Date(String(formData.get("scheduledAt"))).toISOString(),
        caption: String(formData.get("caption") || ""),
        hashtags,
        privacyLevel,
        disableDuet,
        disableStitch,
        disableComment,
        isAigc,
        brandContentToggle,
        brandOrganicToggle,
        privacySettings: buildTikTokPrivacySettings({
          privacyLevel,
          disableDuet,
          disableStitch,
          disableComment,
          isAigc,
          brandContentToggle,
          brandOrganicToggle,
        }),
      });
      await refresh();
      setMessage("Post review saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setActionBusy(false);
    }
  }

  const createPanel = (
    <aside className="panel create-panel">
      <div className="panel-title">
        <WandSparkles size={18} />
        <h2>Create Batch</h2>
      </div>
      <form
        onSubmit={(event) => void runAction("Batch creation", () => createBatch(event))}
        className="stack"
      >
        <label>
          Audio source
          <input
            type="file"
            accept="audio/*"
            onChange={(event) => setAudio(event.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Visual prompt
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} />
        </label>
        <div className="split source-split">
          <label>
            Posts
            <input
              type="number"
              min={1}
              max={250}
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            />
          </label>
          <label>
            Source
            <select
              value={sourceMode}
              onChange={(event) => setSourceMode(event.target.value as SourceMode)}
            >
              <option value="stock">Stock footage (fal pipeline)</option>
              <option value="mixed">Mixed: stock + Seedance (fal)</option>
              <option value="seedance">Seedance via fal.ai</option>
              <option value="gmi_seedance">GMI Seedance 2</option>
            </select>
          </label>
        </div>
        <div className="split schedule-split">
          <label>
            Start
            <input
              type="datetime-local"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
            />
          </label>
          <label>
            Cadence min
            <input
              type="number"
              min={5}
              value={cadence}
              onChange={(event) => setCadence(Number(event.target.value))}
            />
          </label>
        </div>
        <button className="button primary" disabled={!accountId || actionBusy} type="submit">
          <UploadCloud size={16} /> Queue generation
        </button>
      </form>

      <div className="action-row">
        <button
          className="button"
          disabled={actionBusy}
          onClick={() =>
            void runAction("Generation worker", () =>
              invokeFunction("fanpage-campaign", { action: "runGenerationWorkers" }),
            )
          }
        >
          <RefreshCcw size={16} /> Generate due
        </button>
        <button
          className="button"
          disabled={actionBusy}
          onClick={() =>
            void runAction("Publish worker", () =>
              invokeFunction("fanpage-campaign", { action: "runPublishWorker" }),
            )
          }
        >
          <Send size={16} /> Publish due
        </button>
      </div>

      <div className="batch-list">
        {data.batches.slice(0, 6).map((batch) => (
          <div className="batch-row" key={batch.id}>
            <span className={`dot ${statusClass(batch.status)}`} />
            <div>
              <strong>{batch.source_mode}</strong>
              <span>
                {batch.post_count} posts - {batch.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );

  const calendarPanel = (
    <StudioCalendarPanel
      posts={data.posts}
      libraryPreviews={data.libraryPreviews}
      accounts={data.accounts}
      view={calendarView}
      onViewChange={setCalendarView}
      filters={filters}
      onFiltersChange={setFilters}
      onEventDrop={(arg) => void updatePostSchedule(arg)}
      onEventClick={(postId) => {
        setSelectedPostId(postId);
        setMessage(null);
      }}
      externalLibraryContainerRef={libraryPanelRef}
      onExternalLibraryDrop={(libraryItemId, scheduledAt) =>
        void scheduleDrop(libraryItemId, scheduledAt)
      }
      audioClipIds={audioClipIds}
    />
  );

  const readyLibraryPanel = (
    <StudioReadyLibraryPanel
      libraryItems={filteredLibraryItems}
      selectedIds={selectedLibraryIds}
      onToggle={toggleLibraryItem}
      onBulkScheduleOpen={() => setBulkDialogOpen(true)}
      containerRef={libraryPanelRef}
    />
  );

  const postReviewPanel = (
    <StudioPostReview
      post={selectedPost}
      account={selectedPostAccount}
      libraryPreview={selectedPreview}
      busy={actionBusy || studioBusy}
      onSave={saveSelectedPost}
      onClose={() => setSelectedPostId(null)}
    />
  );

  return (
    <main
      className={`app-shell ${mode === "studio" ? "studio-shell" : ""}`}
      data-studio-view={mode === "studio" ? studioView : undefined}
    >
      <header className="topbar">
        <div>
          <h1 style={{ fontSize: 18 }}>
            {mode === "studio" ? "Studio" : "Autopilot"}
          </h1>
          <p>
            {mode === "studio"
              ? "Calendar + post review for queued TikTok publishes"
              : "Guided audio → captions → library workflow"}
          </p>
        </div>
        <div className="topbar-actions">
          {mode === "studio" ? (
            <div className="studio-view-toggle" role="tablist" aria-label="Studio view">
              <button
                type="button"
                className={`button ${studioView === "create" ? "primary" : "ghost"}`}
                onClick={() => setStudioView("create")}
              >
                Create
              </button>
              <button
                type="button"
                className={`button ${studioView === "calendar" ? "primary" : "ghost"}`}
                onClick={() => setStudioView("calendar")}
              >
                Calendar
              </button>
            </div>
          ) : null}
          <select
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            aria-label="Account"
          >
            {data.accounts.length === 0 ? <option value="">No accounts</option> : null}
            {data.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.handle || account.tiktok_display_name || account.id.slice(0, 8)}
              </option>
            ))}
          </select>
          {accountId ? (
            <a className="button ghost" href={buildTikTokConnectUrl(SUPABASE_URL, accountId)}>
              <PlugZap size={16} />{" "}
              {selectedAccount?.tiktok_connected_at ? "Reconnect" : "Connect TikTok"}
            </a>
          ) : null}
        </div>
      </header>


      {studioError ? <div className="banner bad">{studioError}</div> : null}
      {message ? <div className="banner">{message}</div> : null}

      {mode === "autopilot" ? (
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("wizard") === "1" ? (
          <AutopilotWizard
            initialTab={lyricsFocusSignal ? "lyrics" : undefined}
            focusLyricsStepSignal={lyricsFocusSignal}
            initialLyricTemplateId={initialQuery.current.lyricTemplateId}
          />
        ) : (
          <AutopilotPanel
            initialTab={lyricsFocusSignal ? "lyrics" : undefined}
            focusLyricsStepSignal={lyricsFocusSignal}
            initialLyricTemplateId={initialQuery.current.lyricTemplateId}
          />
        )
      ) : (
        <>
          {blockedPostCount > 0 ? (
            <div className="banner warn">
              {blockedPostCount} scheduled post{blockedPostCount === 1 ? "" : "s"} need publishing
              attention.
            </div>
          ) : null}

          {studioView === "create" ? (
            <section className="dashboard-grid">
              {createPanel}
              <section className="stack">
                <div className="action-row">
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => setReadyLibraryOpen((open) => !open)}
                  >
                    <CalendarDays size={14} /> Ready library
                  </button>
                  <button
                    className="button ghost"
                    type="button"
                    disabled={studioBusy}
                    onClick={refresh}
                  >
                    <RefreshCcw className={studioBusy ? "spin" : undefined} size={14} /> Refresh
                  </button>
                </div>
                {readyLibraryOpen ? readyLibraryPanel : null}
                {calendarPanel}
              </section>
              {postReviewPanel}
            </section>
          ) : (
            <div className={`calendar-workspace ${selectedPost ? "has-review" : ""}`}>
              {readyLibraryPanel}
              <section className="stack">{calendarPanel}</section>
              {selectedPost ? postReviewPanel : null}
            </div>
          )}

          {bulkDialogOpen ? (
            <BulkScheduleDialog
              libraryItemIds={Array.from(selectedLibraryIds)}
              onClose={() => setBulkDialogOpen(false)}
              onScheduled={() => {
                setBulkDialogOpen(false);
                setSelectedLibraryIds(new Set());
                void refresh();
              }}
            />
          ) : null}
        </>
      )}
    </main>
  );
}
