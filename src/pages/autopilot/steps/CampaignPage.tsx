import { CampaignStep } from "@/components/autopilot/CampaignStep";
import { useAutopilot } from "../useAutopilot";

export default function CampaignPage() {
  const ctx = useAutopilot();
  return (
    <div className="autopilot-focused-step">
      <CampaignStep
        busy={ctx.busy}
        cadenceMinutes={ctx.cadenceMinutes}
        duration={ctx.duration}
        lyricTemplateMatchesAudio={ctx.campaignHandoff.templateMatchesAudio}
        lyricTemplateReady={!!ctx.lyricTemplateId}
        lyricTemplateStatus={ctx.campaignHandoff.templateStatus}
        postCount={ctx.postCount}
        prompt={ctx.prompt}
        publishPrivacy={ctx.publishPrivacy}
        schemaReady={ctx.schemaReady}
        seedanceResolution={ctx.seedanceResolution}
        sourceMode={ctx.sourceMode}
        categories={ctx.categories}
        categoriesLoading={ctx.categoriesLoading}
        poolCounts={ctx.poolCounts}
        categoryId={ctx.categoryId}
        subcategorySlug={ctx.subcategorySlug}
        randomize={ctx.randomize}
        autoRender={ctx.autoRender}
        requiredShots={ctx.selectedTemplate?.cut_marker_count ?? 1}
        sportsAllowedChannels={ctx.sportsAllowedChannels}
        sportsLeague={ctx.sportsLeague}
        sportsOwnerAssetUrls={ctx.sportsOwnerAssetUrls}
        sportsTeam={ctx.sportsTeam}
        startAt={ctx.startAt}
        stockAllowReuse={ctx.stockAllowReuse}
        stockAvoidReuse={ctx.stockAvoidReuse}
        stockCategory={ctx.stockCategory}
        stockKeywords={ctx.stockKeywords}
        stockMood={ctx.stockMood}
        stockNegativeKeywords={ctx.stockNegativeKeywords}
        stockPortraitOnly={ctx.stockPortraitOnly}
        stockProviders={ctx.stockProviders}
        streamerAllowedChannels={ctx.streamerAllowedChannels}
        streamerName={ctx.streamerName}
        trimmedAudioReady={
          (!!ctx.trimmedAudio && !!ctx.registeredAudioClip) ||
          (!!ctx.campaignHandoff.audioClipId && !!ctx.campaignHandoff.trimmedAudioAssetId)
        }
        showSubmitButton={false}
        onCadenceMinutes={ctx.setCadenceMinutes}
        onPostCount={ctx.setPostCount}
        onPrompt={ctx.setPrompt}
        onPublishPrivacy={ctx.setPublishPrivacy}
        onSeedanceResolution={ctx.setSeedanceResolution}
        onCategoryId={ctx.setCategoryId}
        onSubcategorySlug={ctx.setSubcategorySlug}
        onRandomize={ctx.setRandomize}
        onAutoRender={ctx.setAutoRender}
        onSportsAllowedChannels={ctx.setSportsAllowedChannels}
        onSportsLeague={ctx.setSportsLeague}
        onSportsOwnerAssetUrls={ctx.setSportsOwnerAssetUrls}
        onSportsTeam={ctx.setSportsTeam}
        onStartAt={ctx.setStartAt}
        onStockAllowReuse={ctx.setStockAllowReuse}
        onStockAvoidReuse={ctx.setStockAvoidReuse}
        onStockCategory={ctx.setStockCategory}
        onStockKeywords={ctx.setStockKeywords}
        onStockMood={ctx.setStockMood}
        onStockNegativeKeywords={ctx.setStockNegativeKeywords}
        onStockPortraitOnly={ctx.setStockPortraitOnly}
        onStockProviders={ctx.setStockProviders}
        onStreamerAllowedChannels={ctx.setStreamerAllowedChannels}
        onStreamerName={ctx.setStreamerName}
      />
    </div>
  );
}
