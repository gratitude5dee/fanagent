import { useMemo, useState } from "react";
import { FileMusic, RotateCcw, SkipForward } from "lucide-react";
import { Link } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { CampaignItem, CampaignPost, CampaignItemSegment } from "@/lib/campaigns/api";
import type { LyricTemplateSummary } from "@/lib/lyrics/types";
import { appRoutes } from "@/lib/routes";

type QueueTableProps = {
  items: CampaignItem[];
  posts: CampaignPost[];
  lyricTemplates: LyricTemplateSummary[];
  onRegenerate: (itemId: string) => Promise<unknown>;
  onSkip: (itemId: string) => Promise<unknown>;
  onSetLyricTemplate: (itemId: string, templateId: string | null) => Promise<unknown>;
};

function statusTone(status: string): string {
  if (["ready", "complete", "posted"].includes(status)) return "good";
  if (["failed", "skipped"].includes(status)) return "bad";
  if (["transcribing", "picking_stock", "rendering", "generating", "posting"].includes(status)) {
    return "warn";
  }
  return "idle";
}

function summarizeSegments(
  segments: CampaignItemSegment[] | null | undefined,
  fallback?: string | null,
): string {
  if (!segments?.length) return fallback || "visuals pending";
  const labels = segments.map((segment) => {
    const source = segment.source || "visual";
    return segment.provider ? `${source}:${segment.provider}` : source;
  });
  return Array.from(new Set(labels)).join(" + ");
}

function needsLyricsRepair(item: CampaignItem): boolean {
  return /LYRIC_TEMPLATE_BLOCKS_MISSING|LYRIC_TEMPLATE_NOT_RENDERABLE|Selected lyric template has no transcribed blocks/i.test(
    item.error_message ?? "",
  );
}

export default function QueueTable({
  items,
  posts,
  lyricTemplates,
  onRegenerate,
  onSkip,
  onSetLyricTemplate,
}: QueueTableProps) {
  const [busyByItem, setBusyByItem] = useState<Record<string, boolean>>({});
  const templateById = useMemo(
    () => new Map(lyricTemplates.map((template) => [template.id, template])),
    [lyricTemplates],
  );

  async function withRowBusy(itemId: string, action: () => Promise<unknown>) {
    setBusyByItem((current) => ({ ...current, [itemId]: true }));
    try {
      await action();
    } finally {
      setBusyByItem((current) => ({ ...current, [itemId]: false }));
    }
  }

  return (
    <TooltipProvider>
      <section className="panel">
        <div className="panel-title">
          <FileMusic size={16} />
          <h3>Generation queue</h3>
        </div>
        <div className="batch-list">
          {items.length === 0 ? (
            <div className="empty-state">No generation items for this campaign.</div>
          ) : (
            items.map((item) => {
              const post = posts.find((candidate) => candidate.generation_item_id === item.id);
              const itemTemplate = item.lyric_template_id
                ? templateById.get(item.lyric_template_id)
                : null;
              const segments = Array.isArray(item.segments) ? item.segments : [];
              const reusedStock = segments.some(
                (segment) => segment.source === "stock" && segment.reused,
              );
              const previewUrl =
                post?.video_url ??
                item.stock_clip_url ??
                segments.find((segment) => segment.url)?.url;
              const rowBusy = busyByItem[item.id] === true;
              const failed = item.status === "failed";
              return (
                <div
                  className={`batch-row queue-row ${failed ? "queue-row--failed" : ""}`}
                  key={item.id}
                >
                  <span className={`dot ${statusTone(item.status)}`} />
                  <div style={{ flex: 1 }}>
                    <strong>{new Date(item.scheduled_at).toLocaleString()}</strong>
                    <span>
                      {item.status}
                      {item.render_provider ? ` · ${item.render_provider}` : ""}
                      {post ? ` · post ${post.status}` : ""}
                    </span>
                    <span>
                      Visuals: {summarizeSegments(segments, item.provider ?? item.render_provider)}
                    </span>
                    {segments.length ? (
                      <span>
                        {segments
                          .map((segment, index) => {
                            const provider = segment.provider ?? segment.source ?? "visual";
                            const reuse = segment.reused ? " reused" : "";
                            return `${index + 1}:${provider}${reuse}`;
                          })
                          .join(" · ")}
                      </span>
                    ) : null}
                    {item.prompt ? <span>{item.prompt.slice(0, 120)}</span> : null}
                    {reusedStock ? (
                      <span className="status-pill warn" style={{ marginTop: 4 }}>
                        reused stock
                      </span>
                    ) : null}
                    {itemTemplate ? (
                      <span className="status-pill" style={{ marginTop: 4 }}>
                        <FileMusic size={12} /> {itemTemplate.title}
                      </span>
                    ) : null}
                    {item.error_message ? (
                      <span className="status-pill bad" style={{ marginTop: 4 }}>
                        {item.error_message}
                      </span>
                    ) : null}
                    {failed && needsLyricsRepair(item) && item.lyric_template_id ? (
                      <Link
                        className="button ghost queue-row__repair"
                        to={appRoutes.lyricsTemplate(item.lyric_template_id)}
                      >
                        Open in Lyrics
                      </Link>
                    ) : null}
                    {item.stage_events?.length ? (
                      <span>
                        {item.stage_events
                          .slice(-3)
                          .map((event) => event.stage)
                          .filter(Boolean)
                          .join(" -> ")}
                      </span>
                    ) : null}
                  </div>
                  {previewUrl ? (
                    <a className="button ghost" href={previewUrl} target="_blank" rel="noreferrer">
                      Preview
                    </a>
                  ) : null}
                  <select
                    value={item.lyric_template_id ?? ""}
                    onChange={(event) =>
                      void withRowBusy(item.id, () =>
                        onSetLyricTemplate(item.id, event.target.value || null),
                      )
                    }
                    disabled={rowBusy}
                    title="Lyrics template"
                    aria-label="Lyrics template"
                    style={{ maxWidth: 180 }}
                  >
                    <option value="">No template</option>
                    {lyricTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.title}
                      </option>
                    ))}
                  </select>
                  {failed ? (
                    <button
                      className="button primary"
                      type="button"
                      disabled={rowBusy}
                      aria-label="Retry render"
                      onClick={() => void withRowBusy(item.id, () => onRegenerate(item.id))}
                    >
                      <RotateCcw className={rowBusy ? "spin" : undefined} size={14} /> Retry render
                    </button>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          className="button ghost"
                          type="button"
                          aria-label="Regenerate"
                          disabled={rowBusy}
                          onClick={() => void withRowBusy(item.id, () => onRegenerate(item.id))}
                        >
                          <RotateCcw className={rowBusy ? "spin" : undefined} size={14} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Regenerate</TooltipContent>
                    </Tooltip>
                  )}
                  <button
                    className="button ghost"
                    type="button"
                    disabled={rowBusy}
                    onClick={() => void withRowBusy(item.id, () => onSkip(item.id))}
                  >
                    <SkipForward size={14} /> Skip
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>
    </TooltipProvider>
  );
}
