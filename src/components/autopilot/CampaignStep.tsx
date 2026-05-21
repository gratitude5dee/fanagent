import { CalendarClock, Info, Loader2 } from "lucide-react";
import type { Duration } from "./UploadStep";
import type { SourceMode } from "@/lib/fanagent/sourceMode";
import { CategoryPicker } from "./CategoryPicker";
import type { CategoryNode, PoolCountIndex } from "@/lib/fanagent/categories";

type StockProviders = {
  library: boolean;
  pexels: boolean;
  pixabay: boolean;
};

type CampaignStepProps = {
  busy: boolean;
  cadenceMinutes: number;
  duration: Duration;
  postCount: number;
  prompt: string;
  publishPrivacy: string;
  lyricTemplateMatchesAudio: boolean;
  lyricTemplateReady: boolean;
  lyricTemplateStatus: string | null;
  schemaReady: boolean;
  seedanceResolution: "480p" | "720p" | "1080p";
  sourceMode: SourceMode;
  categories: CategoryNode[];
  poolCounts: PoolCountIndex | null;
  categoriesLoading: boolean;
  categoryId: string;
  subcategorySlug: string;
  randomize: boolean;
  autoRender: boolean;
  requiredShots?: number;
  showSubmitButton?: boolean;
  submitLabel?: string;

  sportsAllowedChannels: string;
  sportsLeague: string;
  sportsOwnerAssetUrls: string;
  sportsTeam: string;
  startAt: string;
  stockAllowReuse: boolean;
  stockAvoidReuse: boolean;
  stockCategory: string;
  stockKeywords: string;
  stockMood: string;
  stockNegativeKeywords: string;
  stockPortraitOnly: boolean;
  stockProviders: StockProviders;
  streamerAllowedChannels: string;
  streamerName: string;
  trimmedAudioReady: boolean;
  onCadenceMinutes: (value: number) => void;
  onPostCount: (value: number) => void;
  onPrompt: (value: string) => void;
  onPublishPrivacy: (value: string) => void;
  onSeedanceResolution: (value: "480p" | "720p" | "1080p") => void;
  onCategoryId: (value: string) => void;
  onSubcategorySlug: (value: string) => void;
  onRandomize: (value: boolean) => void;
  onAutoRender: (value: boolean) => void;
  onSportsAllowedChannels: (value: string) => void;
  onSportsLeague: (value: string) => void;
  onSportsOwnerAssetUrls: (value: string) => void;
  onSportsTeam: (value: string) => void;
  onStartAt: (value: string) => void;
  onStockAllowReuse: (value: boolean) => void;
  onStockAvoidReuse: (value: boolean) => void;
  onStockCategory: (value: string) => void;
  onStockKeywords: (value: string) => void;
  onStockMood: (value: string) => void;
  onStockNegativeKeywords: (value: string) => void;
  onStockPortraitOnly: (value: boolean) => void;
  onStockProviders: (value: StockProviders) => void;
  onStreamerAllowedChannels: (value: string) => void;
  onStreamerName: (value: string) => void;
};

// Source mode options preserve disabled={option.disabled} gating in the parent wizard.
export function CampaignStep(props: CampaignStepProps) {
  const required = Math.max(1, props.requiredShots ?? 1);
  const selectedCategory = props.categories.find((c) => c.id === props.categoryId) ?? null;
  const exactPoolCount =
    props.poolCounts && selectedCategory
      ? selectedCategory.children.length > 0 && props.subcategorySlug
        ? props.poolCounts.get(selectedCategory.id, props.subcategorySlug)
        : props.poolCounts.totalForCategory(selectedCategory.id)
      : 0;
  // Hard block: a non-randomize run with a known-but-too-small pool will
  // fail mid-render. Force the user to randomize or broaden first.
  const poolBlocked =
    !props.randomize &&
    props.poolCounts != null &&
    selectedCategory != null &&
    exactPoolCount > 0 &&
    exactPoolCount < required;

  return (
    <section className="panel">
      <div className="panel-title">
        <CalendarClock size={16} />
        <h3>4. Campaign parameters</h3>
      </div>
      <div className="stack">
        <label>
          Theme / visual prompt
          <textarea
            rows={2}
            value={props.prompt}
            onChange={(e) => props.onPrompt(e.target.value)}
          />
        </label>
        <CategoryPicker
          categories={props.categories}
          poolCounts={props.poolCounts}
          loading={props.categoriesLoading}
          categoryId={props.categoryId}
          subcategorySlug={props.subcategorySlug}
          randomize={props.randomize}
          autoRender={props.autoRender}
          requiredShots={props.requiredShots}
          onCategoryId={props.onCategoryId}
          onSubcategorySlug={props.onSubcategorySlug}
          onRandomize={props.onRandomize}
          onAutoRender={props.onAutoRender}
        />

        <div className="split">
          <label>
            Videos to generate
            <input
              type="number"
              min={1}
              max={250}
              value={props.postCount}
              onChange={(e) => props.onPostCount(Number(e.target.value))}
            />
          </label>
          <div />
        </div>
        <div className="split schedule-split">
          <label>
            Draft calendar start
            <input
              type="datetime-local"
              value={props.startAt}
              onChange={(e) => props.onStartAt(e.target.value)}
            />
          </label>
          <label>
            Draft cadence min
            <input
              type="number"
              min={5}
              max={10080}
              value={props.cadenceMinutes}
              onChange={(e) => props.onCadenceMinutes(Number(e.target.value))}
            />
          </label>
        </div>
        <section className="panel subtle-panel">
          <div className="panel-title">
            <Info size={14} />
            <h4>Source controls</h4>
          </div>
          <div className="action-row" style={{ flexWrap: "wrap" }}>
            {(["library", "pexels", "pixabay"] as const).map((provider) => (
              <label className="check" key={provider}>
                <input
                  type="checkbox"
                  checked={props.stockProviders[provider]}
                  onChange={(event) =>
                    props.onStockProviders({
                      ...props.stockProviders,
                      [provider]: event.target.checked,
                    })
                  }
                />{" "}
                {provider}
              </label>
            ))}
            <label className="check">
              <input
                type="checkbox"
                checked={props.stockPortraitOnly}
                onChange={(e) => props.onStockPortraitOnly(e.target.checked)}
              />{" "}
              portrait only
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={props.stockAvoidReuse}
                onChange={(e) => props.onStockAvoidReuse(e.target.checked)}
              />{" "}
              avoid repeats
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={props.stockAllowReuse}
                onChange={(e) => props.onStockAllowReuse(e.target.checked)}
              />{" "}
              reuse if exhausted
            </label>
          </div>
          <div className="split">
            <label>
              Keywords
              <input
                value={props.stockKeywords}
                onChange={(e) => props.onStockKeywords(e.target.value)}
                placeholder="concert, neon, crowd"
              />
            </label>
            <label>
              Avoid
              <input
                value={props.stockNegativeKeywords}
                onChange={(e) => props.onStockNegativeKeywords(e.target.value)}
                placeholder="logo, watermark"
              />
            </label>
          </div>
          <div className="split">
            <label>
              Category
              <input
                value={props.stockCategory}
                onChange={(e) => props.onStockCategory(e.target.value)}
                placeholder="music"
              />
            </label>
            <label>
              Mood
              <input
                value={props.stockMood}
                onChange={(e) => props.onStockMood(e.target.value)}
                placeholder="high energy"
              />
            </label>
          </div>
          {props.sourceMode === "sports_edit" ? (
            <>
              <div className="split">
                <label>
                  League
                  <input
                    value={props.sportsLeague}
                    onChange={(e) => props.onSportsLeague(e.target.value)}
                    placeholder="NBA, WNBA, EPL"
                  />
                </label>
                <label>
                  Team
                  <input
                    value={props.sportsTeam}
                    onChange={(e) => props.onSportsTeam(e.target.value)}
                    placeholder="Lakers, Liberty"
                  />
                </label>
              </div>
              <label>
                Allowed YouTube channels
                <input
                  value={props.sportsAllowedChannels}
                  onChange={(e) => props.onSportsAllowedChannels(e.target.value)}
                  placeholder="UC..., @officialchannel"
                />
              </label>
              <label>
                Owner MP4 asset URLs
                <textarea
                  rows={3}
                  value={props.sportsOwnerAssetUrls}
                  onChange={(e) => props.onSportsOwnerAssetUrls(e.target.value)}
                  placeholder="youtubeVideoId=https://cdn.example.com/owned-edit.mp4"
                />
              </label>
            </>
          ) : null}
          {props.sourceMode === "streamer_clip" ? (
            <div className="split">
              <label>
                Streamer
                <input
                  value={props.streamerName}
                  onChange={(e) => props.onStreamerName(e.target.value)}
                  placeholder="creatorname"
                />
              </label>
              <label>
                Allowed Twitch channels
                <input
                  value={props.streamerAllowedChannels}
                  onChange={(e) => props.onStreamerAllowedChannels(e.target.value)}
                  placeholder="creatorname, teammate"
                />
              </label>
            </div>
          ) : null}
          <label>
            fal Seedance resolution
            <select
              value={props.seedanceResolution}
              onChange={(e) =>
                props.onSeedanceResolution(e.target.value as "480p" | "720p" | "1080p")
              }
            >
              <option value="480p">480p draft</option>
              <option value="720p">720p balanced</option>
              <option value="1080p">1080p final</option>
            </select>
          </label>
          <label>
            TikTok privacy default
            <select
              value={props.publishPrivacy}
              onChange={(e) => props.onPublishPrivacy(e.target.value)}
            >
              <option value="SELF_ONLY">SELF_ONLY</option>
              <option value="MUTUAL_FOLLOW_FRIENDS">MUTUAL_FOLLOW_FRIENDS</option>
              <option value="FOLLOWER_OF_CREATOR">FOLLOWER_OF_CREATOR</option>
              <option value="PUBLIC_TO_EVERYONE">PUBLIC_TO_EVERYONE</option>
            </select>
          </label>
        </section>
        <div className="banner" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <Info size={14} style={{ marginTop: 2, flexShrink: 0 }} />
          <span>
            Stock and library clips are ranked for vertical aspect and duration fit. Seedance modes
            generate per-segment AI video. Sports and streamer modes stay disabled until official
            API credentials and allowlists are configured.
          </span>
        </div>
        {props.duration > 15 ? (
          <div className="banner">
            {Math.ceil(props.duration / 15)} clips per post will be stitched together with ffmpeg.
          </div>
        ) : null}
        {!props.trimmedAudioReady ? (
          <div className="banner warn">Trim and register audio before generating the library.</div>
        ) : null}
        {props.trimmedAudioReady && !props.lyricTemplateReady ? (
          <div className="banner warn">
            {props.lyricTemplateStatus && props.lyricTemplateStatus !== "saved"
              ? `Save the lyric template first. Current status: ${props.lyricTemplateStatus}.`
              : props.lyricTemplateMatchesAudio
                ? "Save the selected lyric template before generating the library."
                : "Select the saved lyric template created from this trimmed audio clip."}
          </div>
        ) : null}
        {props.showSubmitButton === false ? null : (
          <button
            className="button primary"
            disabled={
              props.busy || !props.trimmedAudioReady || !props.lyricTemplateReady || poolBlocked
            }
            type="submit"
          >
            {props.busy ? <Loader2 className="spin" size={16} /> : <CalendarClock size={16} />}{" "}
            {props.submitLabel ?? "Generate videos"}
          </button>
        )}
      </div>
    </section>
  );
}
