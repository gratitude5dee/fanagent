import { useEffect, useMemo, useRef, useState } from "react";
import type { EventDropArg, EventInput } from "@fullcalendar/core";
import { Link } from "react-router-dom";
import { CalendarDays, ExternalLink, Home, Images, PlugZap, RefreshCcw, Send } from "lucide-react";
import BulkScheduleDialog from "@/components/calendar/BulkScheduleDialog";
import FanAgentCalendar from "@/components/FanAgentCalendar";
import { listReadyLibraryItems, scheduleLibraryItems } from "@/lib/library/api";
import { displayError } from "@/lib/errors";
import type { LibraryItem } from "@/lib/library/types";
import { SUPABASE_URL, supabase } from "@/integrations/supabase/client";
import { buildTikTokConnectUrl } from "@/lib/fanagent/accounts";
import {
  CALENDAR_STATUS_FILTERS,
  CALENDAR_VIEWS,
  calendarEventForPost,
  creatorPrivacyOptions,
  filterCalendarLibraryItems,
  filterCalendarPosts,
  isCreatorCommentDisabled,
  isPostReadOnly,
  isPastScheduleDrop,
  isPrivacyLevelAvailable,
  needsTikTokConnection,
  provenanceSummary,
  publishStatusLabel,
  statusTone,
  TIKTOK_PRIVACY_LEVELS,
  tiktokPostUrl,
  toLocalInputValue,
  type CalendarAccount,
  type CalendarFilters,
  type CalendarLibraryPreview,
  type CalendarPost,
  type CalendarStatusFilter,
  type CalendarView,
  buildTikTokPrivacySettings,
} from "@/lib/calendar/posts";

type FunctionEnvelope<T> = {
  success: boolean;
  code?: string;
  message?: string;
  data: T | null;
  error?: string | null;
};

function unwrapFunctionData<T>(value: unknown): T {
  if (typeof value !== "object" || value === null || !("success" in value)) return value as T;
  const envelope = value as FunctionEnvelope<T>;
  if (envelope.success) return envelope.data as T;
  throw new Error(envelope.error || envelope.message || envelope.code || "Function failed");
}

function titleForItem(item: LibraryItem): string {
  return item.default_caption || `Library clip ${item.library_index + 1}`;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function coerceLibraryPreview(row: Record<string, unknown>): CalendarLibraryPreview {
  return {
    id: String(row.id),
    audio_clip_id: String(row.audio_clip_id),
    library_index: Number(row.library_index ?? 0),
    duration_sec: Number(row.duration_sec ?? 0),
    status: String(row.status ?? "not_ready"),
    segments: arrayValue(row.segments),
    provenance: arrayValue(row.provenance),
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function coerceCalendarAccount(row: Record<string, unknown>): CalendarAccount {
  return {
    id: String(row.id),
    handle: typeof row.handle === "string" ? row.handle : null,
    tiktok_creator_info: objectValue(row.tiktok_creator_info),
  };
}

export default function CalendarPage() {
  const libraryPanelRef = useRef<HTMLDivElement>(null);
  const [posts, setPosts] = useState<CalendarPost[]>([]);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<Set<string>>(() => new Set());
  const [libraryPreviews, setLibraryPreviews] = useState<CalendarLibraryPreview[]>([]);
  const [accounts, setAccounts] = useState<CalendarAccount[]>([]);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [calendarView, setCalendarView] = useState<CalendarView>("week");
  const [filters, setFilters] = useState<CalendarFilters>({
    accountId: "",
    audioClipId: "",
    status: "all",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setMessage(null);
    try {
      const [postRows, readyItems] = await Promise.all([
        supabase
          .from("posts")
          .select(
            "id,account_id,caption,hashtags,scheduled_at,status,publish_status,video_url,library_item_id,tiktok_privacy_level,tiktok_disable_duet,tiktok_disable_stitch,tiktok_disable_comment,tiktok_is_aigc,tiktok_brand_content,tiktok_brand_organic,tiktok_post_id,posted_at",
          )
          .order("scheduled_at", { ascending: true })
          .limit(250),
        listReadyLibraryItems(80),
      ]);
      if (postRows.error) throw postRows.error;
      const nextPosts = (postRows.data ?? []) as CalendarPost[];
      setPosts(nextPosts);
      setLibraryItems(readyItems);
      const accountIds = Array.from(
        new Set(
          [
            ...nextPosts.map((post) => post.account_id),
            ...readyItems.map((item) => item.account_id),
          ].filter((id) => id.length > 0),
        ),
      );
      if (accountIds.length > 0) {
        const accountRows = await supabase
          .from("accounts")
          .select("id,handle,tiktok_creator_info")
          .in("id", accountIds);
        if (accountRows.error) throw accountRows.error;
        setAccounts(
          ((accountRows.data ?? []) as Record<string, unknown>[]).map(coerceCalendarAccount),
        );
      } else {
        setAccounts([]);
      }
      const libraryIds = Array.from(
        new Set(
          nextPosts
            .map((post) => post.library_item_id)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      );
      if (libraryIds.length > 0) {
        const previews = await supabase
          .from("video_library_items")
          .select("id,audio_clip_id,library_index,duration_sec,status,segments,provenance")
          .in("id", libraryIds);
        if (previews.error) throw previews.error;
        setLibraryPreviews(
          ((previews.data ?? []) as Record<string, unknown>[]).map(coerceLibraryPreview),
        );
      } else {
        setLibraryPreviews([]);
      }
      setSelectedPostId((current) =>
        current && nextPosts.some((post) => post.id === current) ? current : null,
      );
    } catch (error) {
      setMessage(displayError(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const filteredPosts = useMemo(
    () => filterCalendarPosts(posts, libraryPreviews, filters),
    [filters, libraryPreviews, posts],
  );
  const filteredLibraryItems = useMemo(
    () => filterCalendarLibraryItems(libraryItems, filters),
    [filters, libraryItems],
  );
  const events = useMemo<EventInput[]>(
    () => filteredPosts.map((post) => calendarEventForPost(post)),
    [filteredPosts],
  );
  const previewById = useMemo(
    () => new Map(libraryPreviews.map((preview) => [preview.id, preview])),
    [libraryPreviews],
  );
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const selectedPost = posts.find((post) => post.id === selectedPostId) ?? null;
  const selectedAccount = selectedPost ? accountById.get(selectedPost.account_id) : null;
  const selectedPreview = selectedPost?.library_item_id
    ? previewById.get(selectedPost.library_item_id)
    : null;
  const selectedCreatorInfo = selectedPost ? (selectedAccount?.tiktok_creator_info ?? null) : null;
  const creatorPrivacyLevelCount = creatorPrivacyOptions(selectedCreatorInfo).length;
  const commentLocked = isCreatorCommentDisabled(selectedCreatorInfo);
  const readOnlyPost = selectedPost ? isPostReadOnly(selectedPost) : false;
  const liveTikTokUrl = selectedPost ? tiktokPostUrl(selectedPost, selectedAccount) : null;
  const blockedPosts = posts.filter((post) => post.publish_status?.startsWith("blocked_"));
  const audioClipIds = useMemo(
    () =>
      Array.from(
        new Set([
          ...libraryPreviews.map((preview) => preview.audio_clip_id),
          ...libraryItems.map((item) => item.audio_clip_id),
        ]),
      ).sort(),
    [libraryItems, libraryPreviews],
  );

  useEffect(() => {
    if (selectedPostId && !filteredPosts.some((post) => post.id === selectedPostId)) {
      setSelectedPostId(null);
    }
  }, [filteredPosts, selectedPostId]);

  useEffect(() => {
    const visibleIds = new Set(filteredLibraryItems.map((item) => item.id));
    setSelectedLibraryIds((current) => {
      const next = new Set(Array.from(current).filter((itemId) => visibleIds.has(itemId)));
      return next.size === current.size ? current : next;
    });
  }, [filteredLibraryItems]);

  async function updatePostSchedule(arg: EventDropArg) {
    const droppedAt = arg.event.start;
    if (!droppedAt) return;
    if (isPastScheduleDrop(droppedAt)) {
      arg.revert();
      setMessage("Cannot reschedule into the past.");
      return;
    }
    const scheduledAt = droppedAt.toISOString();
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke("update-post-schedule", {
        body: { postId: arg.event.id, scheduledAt },
      });
      if (error) {
        if (data) unwrapFunctionData(data);
        throw new Error(error.message);
      }
      unwrapFunctionData(data);
      await refresh();
    } catch (error) {
      arg.revert();
      setMessage(displayError(error));
    } finally {
      setBusy(false);
    }
  }

  async function scheduleDrop(libraryItemId: string, scheduledAt: Date) {
    if (isPastScheduleDrop(scheduledAt)) {
      setMessage("Cannot reschedule into the past.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await scheduleLibraryItems([{ libraryItemId, scheduledAt: scheduledAt.toISOString() }]);
      setSelectedLibraryIds(new Set());
      await refresh();
      setMessage("Library item scheduled.");
    } catch (error) {
      setMessage(displayError(error));
      await refresh();
    } finally {
      setBusy(false);
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

  async function saveSelectedPost(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPost || readOnlyPost) return;
    const formData = new FormData(event.currentTarget);
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
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke("update-post-schedule", {
        body: {
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
        },
      });
      if (error) {
        if (data) unwrapFunctionData(data);
        throw new Error(error.message);
      }
      unwrapFunctionData(data);
      await refresh();
      setMessage("Post review saved.");
    } catch (error) {
      setMessage(displayError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell calendar-page">
      <header className="topbar">
        <div>
          <h1>Calendar</h1>
          <p>Drag ready library items onto open slots or bulk schedule a set.</p>
        </div>
        <div className="topbar-actions">
          <Link className="button ghost" to="/">
            <Home size={14} /> Home
          </Link>
          <Link className="button ghost" to="/library">
            <Images size={14} /> Library
          </Link>
          <Link className="button ghost" to="/settings/accounts">
            <PlugZap size={14} /> Accounts
          </Link>
          <button className="button ghost" type="button" disabled={busy} onClick={refresh}>
            <RefreshCcw className={busy ? "spin" : undefined} size={14} /> Refresh
          </button>
        </div>
      </header>

      {message ? <div className="banner">{message}</div> : null}
      {blockedPosts.length > 0 ? (
        <div className="banner warn">
          {blockedPosts.length} scheduled post{blockedPosts.length === 1 ? "" : "s"} need publishing
          attention.
        </div>
      ) : null}

      <section className="panel calendar-controls" aria-label="Calendar controls">
        <div className="calendar-view-toggle" aria-label="Calendar view">
          {CALENDAR_VIEWS.map((view) => (
            <button
              key={view}
              type="button"
              className={`button ${calendarView === view ? "primary" : "ghost"}`}
              onClick={() => setCalendarView(view)}
            >
              {view === "month"
                ? "Month"
                : view === "week"
                  ? "Week"
                  : view === "day"
                    ? "Day"
                    : "Agenda"}
            </button>
          ))}
        </div>
        <div className="calendar-filter-row">
          <label>
            Account
            <select
              value={filters.accountId}
              onChange={(event) =>
                setFilters((current) => ({ ...current, accountId: event.target.value }))
              }
            >
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.handle ?? account.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Audio clip
            <select
              value={filters.audioClipId}
              onChange={(event) =>
                setFilters((current) => ({ ...current, audioClipId: event.target.value }))
              }
            >
              <option value="">All audio clips</option>
              {audioClipIds.map((audioClipId) => (
                <option key={audioClipId} value={audioClipId}>
                  {audioClipId.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.target.value as CalendarStatusFilter,
                }))
              }
            >
              {CALENDAR_STATUS_FILTERS.map((status) => (
                <option key={status} value={status}>
                  {status === "all" ? "All statuses" : status.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="calendar-legend" aria-label="Calendar color legend">
          <span>
            <i className="event-idle" /> Pending
          </span>
          <span>
            <i className="event-warn" /> Posting
          </span>
          <span>
            <i className="event-good" /> Posted
          </span>
          <span>
            <i className="event-bad" /> Failed
          </span>
          <span>
            <i className="event-muted" /> Skipped
          </span>
          <span>
            <i className="event-blocked" /> Blocked
          </span>
          <strong>{filteredPosts.length} visible</strong>
        </div>
      </section>

      <div className={`calendar-workspace ${selectedPost ? "has-review" : ""}`}>
        <aside className="panel calendar-library-panel" ref={libraryPanelRef}>
          <div className="panel-title">
            <CalendarDays size={16} />
            <h2>Ready library</h2>
          </div>
          <div className="library-bulkbar">
            <span>{selectedLibraryIds.size} selected</span>
            <button
              type="button"
              className="button primary"
              disabled={selectedLibraryIds.size === 0}
              onClick={() => setDialogOpen(true)}
            >
              Schedule selected
            </button>
          </div>
          <div className="calendar-library-list">
            {filteredLibraryItems.length === 0 ? (
              <div className="empty-state">No ready library items yet.</div>
            ) : (
              filteredLibraryItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`calendar-library-card ${selectedLibraryIds.has(item.id) ? "selected" : ""}`}
                  data-library-item-id={item.id}
                  data-title={titleForItem(item)}
                  draggable
                  onClick={() => toggleLibraryItem(item.id)}
                >
                  <span>{item.duration_sec}s</span>
                  <strong>{titleForItem(item)}</strong>
                  <small>Drag to schedule · click to select</small>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="panel calendar-panel">
          {calendarView === "agenda" ? (
            <div className="calendar-agenda">
              {filteredPosts.length === 0 ? (
                <div className="empty-state">No scheduled posts match these filters.</div>
              ) : (
                filteredPosts.map((post) => {
                  const account = accountById.get(post.account_id);
                  return (
                    <button
                      key={post.id}
                      type="button"
                      className="calendar-agenda-row"
                      onClick={() => {
                        setSelectedPostId(post.id);
                        setMessage(null);
                      }}
                    >
                      <span className={`dot ${statusTone(post)}`} />
                      <div>
                        <strong>{new Date(post.scheduled_at).toLocaleString()}</strong>
                        <span>{post.caption || "Scheduled post"}</span>
                        <small>
                          {account?.handle ?? post.account_id.slice(0, 8)} · {post.status} ·{" "}
                          {publishStatusLabel(post.publish_status)}
                        </small>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <FanAgentCalendar
              view={calendarView}
              events={events}
              onEventDrop={updatePostSchedule}
              onEventClick={(postId) => {
                setSelectedPostId(postId);
                setMessage(null);
              }}
              externalLibraryContainerRef={libraryPanelRef}
              onExternalLibraryDrop={scheduleDrop}
            />
          )}
        </section>

        {selectedPost ? (
          <aside className="panel calendar-review-panel">
            <div className="panel-title">
              <Send size={16} />
              <h2>Post Review</h2>
            </div>
            <form
              className="stack calendar-post-form"
              key={selectedPost.id}
              onSubmit={saveSelectedPost}
            >
              <div className={`status-pill ${statusTone(selectedPost)}`}>
                {selectedPost.status} · {publishStatusLabel(selectedPost.publish_status)}
              </div>
              {needsTikTokConnection(selectedPost) ? (
                <a
                  className="button primary"
                  href={buildTikTokConnectUrl(SUPABASE_URL, selectedPost.account_id)}
                >
                  <PlugZap size={14} /> Connect TikTok
                </a>
              ) : null}
              {readOnlyPost ? (
                <div className="calendar-creator-note">
                  Posted TikToks are read-only in FanAgent.
                </div>
              ) : null}
              {liveTikTokUrl ? (
                <a className="button primary" href={liveTikTokUrl} rel="noreferrer" target="_blank">
                  <ExternalLink size={14} /> Open TikTok
                </a>
              ) : selectedPost.tiktok_post_id ? (
                <div className="calendar-provenance">
                  <span>TikTok post</span>
                  <strong>{selectedPost.tiktok_post_id}</strong>
                </div>
              ) : null}
              <fieldset className="calendar-review-fields" disabled={readOnlyPost}>
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
                    {TIKTOK_PRIVACY_LEVELS.map((level) => (
                      <option
                        key={level}
                        value={level}
                        disabled={!isPrivacyLevelAvailable(level, selectedCreatorInfo)}
                      >
                        {level}
                      </option>
                    ))}
                  </select>
                </label>
                {creatorPrivacyLevelCount > 0 ? (
                  <div className="calendar-creator-note">
                    {creatorPrivacyLevelCount} TikTok privacy option
                    {creatorPrivacyLevelCount === 1 ? "" : "s"} available for this account.
                  </div>
                ) : null}
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
                    defaultChecked={commentLocked || (selectedPost.tiktok_disable_comment ?? false)}
                    disabled={commentLocked}
                  />{" "}
                  Disable comments
                </label>
                {commentLocked ? (
                  <div className="calendar-creator-note">
                    TikTok creator settings require comments disabled.
                  </div>
                ) : null}
                <label className="check">
                  <input
                    name="isAigc"
                    type="checkbox"
                    defaultChecked={selectedPost.tiktok_is_aigc ?? true}
                  />{" "}
                  AIGC label
                </label>
                <label className="check">
                  <input
                    name="brandContentToggle"
                    type="checkbox"
                    defaultChecked={selectedPost.tiktok_brand_content ?? false}
                  />{" "}
                  Brand content
                </label>
                <label className="check">
                  <input
                    name="brandOrganicToggle"
                    type="checkbox"
                    defaultChecked={selectedPost.tiktok_brand_organic ?? false}
                  />{" "}
                  Organic brand
                </label>
              </fieldset>
              {selectedPost.video_url ? (
                <video
                  className="calendar-post-video"
                  src={selectedPost.video_url}
                  controls
                  muted
                  playsInline
                />
              ) : null}
              <div className="calendar-provenance">
                <span>Provenance</span>
                <strong>{provenanceSummary(selectedPreview)}</strong>
              </div>
              {selectedPreview ? (
                <Link className="button ghost" to={`/library/${selectedPreview.audio_clip_id}`}>
                  <ExternalLink size={14} /> View library item
                </Link>
              ) : null}
              <div className="action-row">
                {readOnlyPost ? null : (
                  <button className="button primary" type="submit" disabled={busy}>
                    Save post
                  </button>
                )}
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => setSelectedPostId(null)}
                >
                  Close
                </button>
              </div>
            </form>
          </aside>
        ) : null}
      </div>

      {dialogOpen ? (
        <BulkScheduleDialog
          libraryItemIds={Array.from(selectedLibraryIds)}
          onClose={() => setDialogOpen(false)}
          onScheduled={() => {
            setDialogOpen(false);
            setSelectedLibraryIds(new Set());
            refresh();
          }}
        />
      ) : null}
    </main>
  );
}
