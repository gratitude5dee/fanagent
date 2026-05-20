import { Link } from "react-router-dom";
import { ExternalLink, PlugZap, Send } from "lucide-react";
import { SUPABASE_URL } from "@/integrations/supabase/client";
import { buildTikTokConnectUrl } from "@/lib/fanagent/accounts";
import {
  creatorPrivacyOptions,
  isCreatorCommentDisabled,
  isPostReadOnly,
  isPrivacyLevelAvailable,
  needsTikTokConnection,
  provenanceSummary,
  publishStatusLabel,
  statusTone,
  TIKTOK_PRIVACY_LEVELS,
  tiktokPostUrl,
  toLocalInputValue,
  type CalendarAccount,
  type CalendarLibraryPreview,
  type CalendarPost,
} from "@/lib/calendar/posts";

export interface StudioPostReviewProps {
  post: CalendarPost | null;
  account: CalendarAccount | null;
  libraryPreview: CalendarLibraryPreview | null;
  busy: boolean;
  onSave: (form: HTMLFormElement) => Promise<void>;
  onClose: () => void;
}

export default function StudioPostReview({
  post,
  account,
  libraryPreview,
  busy,
  onSave,
  onClose,
}: StudioPostReviewProps) {
  if (!post) {
    return (
      <aside className="panel post-panel">
        <div className="panel-title">
          <Send size={18} />
          <h2>Post Review</h2>
        </div>
        <div className="empty-state">Select a scheduled item.</div>
      </aside>
    );
  }

  const creatorInfo = account?.tiktok_creator_info ?? null;
  const creatorPrivacyLevelCount = creatorPrivacyOptions(creatorInfo).length;
  const commentLocked = isCreatorCommentDisabled(creatorInfo);
  const readOnlyPost = isPostReadOnly(post);
  const liveTikTokUrl = tiktokPostUrl(post, account);

  return (
    <aside className="panel calendar-review-panel">
      <div className="panel-title">
        <Send size={16} />
        <h2>Post Review</h2>
      </div>
      <form
        className="stack calendar-post-form"
        key={post.id}
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(event.currentTarget);
        }}
      >
        <div className={`status-pill ${statusTone(post)}`}>
          {post.status} - {publishStatusLabel(post.publish_status)}
        </div>
        {needsTikTokConnection(post) ? (
          <a className="button primary" href={buildTikTokConnectUrl(SUPABASE_URL, post.account_id)}>
            <PlugZap size={14} /> Connect TikTok
          </a>
        ) : null}
        {readOnlyPost ? (
          <div className="calendar-creator-note">Posted TikToks are read-only in FanAgent.</div>
        ) : null}
        {liveTikTokUrl ? (
          <a className="button primary" href={liveTikTokUrl} rel="noreferrer" target="_blank">
            <ExternalLink size={14} /> Open TikTok
          </a>
        ) : post.tiktok_post_id ? (
          <div className="calendar-provenance">
            <span>TikTok post</span>
            <strong>{post.tiktok_post_id}</strong>
          </div>
        ) : null}
        <fieldset className="calendar-review-fields" disabled={readOnlyPost}>
          <label>
            Caption
            <textarea name="caption" rows={5} defaultValue={post.caption} />
          </label>
          <label>
            Hashtags
            <input name="hashtags" defaultValue={(post.hashtags ?? []).join(" ")} />
          </label>
          <label>
            Scheduled
            <input
              name="scheduledAt"
              type="datetime-local"
              defaultValue={toLocalInputValue(new Date(post.scheduled_at))}
            />
          </label>
          <label>
            TikTok privacy
            <select name="privacyLevel" defaultValue={post.tiktok_privacy_level ?? ""}>
              <option value="">Choose before publish</option>
              {TIKTOK_PRIVACY_LEVELS.map((level) => (
                <option
                  key={level}
                  value={level}
                  disabled={!isPrivacyLevelAvailable(level, creatorInfo)}
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
              defaultChecked={post.tiktok_disable_duet ?? true}
            />{" "}
            Disable duet
          </label>
          <label className="check">
            <input
              name="disableStitch"
              type="checkbox"
              defaultChecked={post.tiktok_disable_stitch ?? true}
            />{" "}
            Disable stitch
          </label>
          <label className="check">
            <input
              name="disableComment"
              type="checkbox"
              defaultChecked={commentLocked || (post.tiktok_disable_comment ?? false)}
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
            <input name="isAigc" type="checkbox" defaultChecked={post.tiktok_is_aigc ?? true} />{" "}
            AIGC label
          </label>
          <label className="check">
            <input
              name="brandContentToggle"
              type="checkbox"
              defaultChecked={post.tiktok_brand_content ?? false}
            />{" "}
            Brand content
          </label>
          <label className="check">
            <input
              name="brandOrganicToggle"
              type="checkbox"
              defaultChecked={post.tiktok_brand_organic ?? false}
            />{" "}
            Organic brand
          </label>
        </fieldset>
        {post.video_url ? (
          <video className="calendar-post-video" src={post.video_url} controls muted playsInline />
        ) : null}
        <div className="calendar-provenance">
          <span>Provenance</span>
          <strong>{provenanceSummary(libraryPreview)}</strong>
        </div>
        {libraryPreview ? (
          <Link className="button ghost" to={`/library/${libraryPreview.audio_clip_id}`}>
            <ExternalLink size={14} /> View library item
          </Link>
        ) : null}
        <div className="action-row">
          {readOnlyPost ? null : (
            <button className="button primary" type="submit" disabled={busy}>
              Save post
            </button>
          )}
          <button className="button ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </aside>
  );
}
