import { lazy, Suspense, useEffect, useMemo, useState, useTransition } from "react";
import type { EventDropArg, EventInput } from "@fullcalendar/core";
import {
  CalendarDays,
  Music4,
  PlugZap,
  RefreshCcw,
  Send,
  Sparkles,
  UploadCloud,
  WandSparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import AutopilotPanel from "@/components/AutopilotPanel";
import { SUPABASE_URL, supabase } from "@/integrations/supabase/client";
import type { Account, DashboardPost, GenerationBatch, SourceMode } from "@/lib/fanagent/types";

const FanAgentCalendar = lazy(() => import("@/components/FanAgentCalendar"));

const privacyLevels = [
  "SELF_ONLY",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "PUBLIC_TO_EVERYONE",
];

function statusClass(status: string): string {
  if (status === "posted" || status === "complete") return "good";
  if (status === "failed" || status === "partial") return "bad";
  if (status === "posting" || status === "generating" || status === "rendering") return "warn";
  return "idle";
}

function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
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
  const { data, error } = await supabase.functions.invoke<T>(name, { body: body ?? {} });

  if (error) {
    throw new Error(error.message);
  }

  return data as T;
}

function tiktokConnectUrl(accountId: string): string {
  return `${SUPABASE_URL}/functions/v1/tiktok-oauth-callback?action=connect&accountId=${encodeURIComponent(accountId)}`;
}

export default function App() {
  const [mode, setMode] = useState<"autopilot" | "studio">("autopilot");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [posts, setPosts] = useState<DashboardPost[]>([]);
  const [batches, setBatches] = useState<GenerationBatch[]>([]);
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
  const [setupError, setSetupError] = useState<string | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null;
  const selectedPost = posts.find((post) => post.id === selectedPostId) ?? posts[0] ?? null;
  const calendarEvents = useMemo<EventInput[]>(
    () =>
      posts.map((post) => ({
        id: post.id,
        title: `${post.status.toUpperCase()} ${post.caption}`,
        start: post.scheduled_at,
        classNames: [`event-${statusClass(post.status)}`],
      })),
    [posts],
  );

  async function loadDashboard() {
    setSetupError(null);

    const [accountsResult, postsResult, batchesResult] = await Promise.all([
      supabase
        .from("accounts")
        .select(
          "id,platform,handle,status,tiktok_connected_at,tiktok_display_name,tiktok_creator_info",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("posts")
        .select(
          "id,account_id,generation_item_id,caption,hashtags,scheduled_at,status,publish_status,video_url,tiktok_privacy_level,tiktok_disable_duet,tiktok_disable_stitch,tiktok_disable_comment",
        )
        .order("scheduled_at", { ascending: true })
        .limit(200),
      supabase
        .from("generation_batches")
        .select("id,account_id,source_mode,status,post_count,prompt,created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (accountsResult.error) throw accountsResult.error;
    if (postsResult.error) throw postsResult.error;
    if (batchesResult.error) throw batchesResult.error;

    const nextAccounts = (accountsResult.data ?? []) as Account[];
    const nextPosts = (postsResult.data ?? []) as DashboardPost[];
    setAccounts(nextAccounts);
    setPosts(nextPosts);
    setBatches((batchesResult.data ?? []) as GenerationBatch[]);
    setAccountId((current) => current || nextAccounts[0]?.id || "");
    setSelectedPostId((current) => current || nextPosts[0]?.id || null);
  }

  useEffect(() => {
    loadDashboard().catch((error) =>
      setSetupError(error instanceof Error ? error.message : String(error)),
    );
  }, []);

  function runAction(label: string, action: () => Promise<unknown>) {
    startTransition(() => {
      action()
        .then(() => loadDashboard())
        .then(() => setMessage(`${label} complete.`))
        .catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
    });
  }

  async function createBatch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!audio) throw new Error("Choose an audio file first.");
    if (!accountId)
      throw new Error("Create or select a TikTok account before queueing generation.");
    if (audio.size > 12 * 1024 * 1024)
      throw new Error("Audio uploads are limited to 12MB in hosted v1.");

    await invokeFunction("create-generation-batch", {
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

  function handleEventDrop(arg: EventDropArg) {
    const scheduledAt = arg.event.start?.toISOString();
    if (!scheduledAt) return;

    runAction("Schedule update", () =>
      invokeFunction("update-post-schedule", {
        postId: arg.event.id,
        scheduledAt,
      }),
    );
  }

  async function saveSelectedPost(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPost) return;
    const formData = new FormData(event.currentTarget);
    const hashtags = String(formData.get("hashtags") || "")
      .split(/\s+/)
      .map((tag) => tag.trim())
      .filter(Boolean);

    await invokeFunction("update-post-schedule", {
      postId: selectedPost.id,
      scheduledAt: new Date(String(formData.get("scheduledAt"))).toISOString(),
      caption: String(formData.get("caption") || ""),
      hashtags,
      privacyLevel: String(formData.get("privacyLevel") || "") || null,
      disableDuet: formData.get("disableDuet") === "on",
      disableStitch: formData.get("disableStitch") === "on",
      disableComment: formData.get("disableComment") === "on",
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>FanAgent</h1>
          <p>React + Supabase audio-to-TikTok queue</p>
        </div>
        <div className="topbar-actions">
          <div className="mode-switch" role="tablist" aria-label="Mode">
            <button
              type="button"
              className={`button ${mode === "autopilot" ? "primary" : "ghost"}`}
              onClick={() => setMode("autopilot")}
            >
              <Sparkles size={14} /> Autopilot
            </button>
            <button
              type="button"
              className={`button ${mode === "studio" ? "primary" : "ghost"}`}
              onClick={() => setMode("studio")}
            >
              <WandSparkles size={14} /> Studio
            </button>
            <Link className="button ghost" to="/lyrics">
              <Music4 size={14} /> Lyrics
            </Link>
          </div>
          {mode === "studio" ? (
            <>
              <select
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                aria-label="Account"
              >
                {accounts.length === 0 ? <option value="">No accounts</option> : null}
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.handle || account.tiktok_display_name || account.id.slice(0, 8)}
                  </option>
                ))}
              </select>
              {accountId ? (
                <a className="button ghost" href={tiktokConnectUrl(accountId)}>
                  <PlugZap size={16} />{" "}
                  {selectedAccount?.tiktok_connected_at ? "Reconnect" : "Connect TikTok"}
                </a>
              ) : null}
            </>
          ) : null}
        </div>
      </header>

      {setupError ? <div className="banner bad">{setupError}</div> : null}
      {message ? <div className="banner">{message}</div> : null}

      {mode === "autopilot" ? (
        <AutopilotPanel />
      ) : (
        <section className="dashboard-grid">
          <aside className="panel create-panel">
            <div className="panel-title">
              <WandSparkles size={18} />
              <h2>Create Batch</h2>
            </div>
            <form
              onSubmit={(event) => runAction("Batch creation", () => createBatch(event))}
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
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={4}
                />
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
              <button className="button primary" disabled={!accountId || isPending} type="submit">
                <UploadCloud size={16} /> Queue generation
              </button>
            </form>

            <div className="action-row">
              <button
                className="button"
                disabled={isPending}
                onClick={() =>
                  runAction("Generation worker", () =>
                    invokeFunction("fanpage-campaign", { action: "runGenerationWorkers" }),
                  )
                }
              >
                <RefreshCcw size={16} /> Generate due
              </button>
              <button
                className="button"
                disabled={isPending}
                onClick={() =>
                  runAction("Publish worker", () =>
                    invokeFunction("fanpage-campaign", { action: "runPublishWorker" }),
                  )
                }
              >
                <Send size={16} /> Publish due
              </button>
            </div>

            <div className="batch-list">
              {batches.slice(0, 6).map((batch) => (
                <div className="batch-row" key={batch.id}>
                  <span className={`dot ${statusClass(batch.status)}`} />
                  <div>
                    <strong>{batch.source_mode}</strong>
                    <span>
                      {batch.post_count} posts · {batch.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <section className="panel calendar-panel">
            <div className="panel-title">
              <CalendarDays size={18} />
              <h2>Schedule</h2>
            </div>
            <Suspense fallback={<div className="calendar-loading">Loading schedule...</div>}>
              <FanAgentCalendar
                events={calendarEvents}
                onEventDrop={handleEventDrop}
                onEventClick={setSelectedPostId}
              />
            </Suspense>
          </section>

          <aside className="panel post-panel">
            <div className="panel-title">
              <Send size={18} />
              <h2>Post Review</h2>
            </div>
            {selectedPost ? (
              <form
                onSubmit={(event) => runAction("Post save", () => saveSelectedPost(event))}
                className="stack"
              >
                <div className={`status-pill ${statusClass(selectedPost.status)}`}>
                  {selectedPost.status} · {selectedPost.publish_status || "not sent"}
                </div>
                <label>
                  Caption
                  <textarea name="caption" rows={5} defaultValue={selectedPost.caption} />
                </label>
                <label>
                  Hashtags
                  <input name="hashtags" defaultValue={(selectedPost.hashtags ?? []).join(" ")} />
                </label>
                <label>
                  Scheduled
                  <input
                    name="scheduledAt"
                    type="datetime-local"
                    defaultValue={toLocalInputValue(new Date(selectedPost.scheduled_at))}
                  />
                </label>
                <label>
                  TikTok privacy
                  <select
                    name="privacyLevel"
                    defaultValue={selectedPost.tiktok_privacy_level ?? ""}
                  >
                    <option value="">Choose before publish</option>
                    {privacyLevels.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  <input
                    name="disableDuet"
                    type="checkbox"
                    defaultChecked={selectedPost.tiktok_disable_duet ?? true}
                  />{" "}
                  Disable duet
                </label>
                <label className="check">
                  <input
                    name="disableStitch"
                    type="checkbox"
                    defaultChecked={selectedPost.tiktok_disable_stitch ?? true}
                  />{" "}
                  Disable stitch
                </label>
                <label className="check">
                  <input
                    name="disableComment"
                    type="checkbox"
                    defaultChecked={selectedPost.tiktok_disable_comment ?? false}
                  />{" "}
                  Disable comments
                </label>
                {selectedPost.video_url ? (
                  <video src={selectedPost.video_url} controls muted playsInline />
                ) : null}
                <button className="button primary" disabled={isPending} type="submit">
                  Save post
                </button>
              </form>
            ) : (
              <div className="empty-state">Select a scheduled item.</div>
            )}
          </aside>
        </section>
      )}
    </main>
  );
}
