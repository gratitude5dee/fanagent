export type FanAgentSchemaDiagnostics = {
  generationBatchesSettings?: boolean;
  generationItemsQueueColumns?: boolean;
  workerRuns?: boolean;
  audioClips?: boolean;
  videoLibrary?: boolean;
  sourceCandidates?: boolean;
  sourceCandidateUses?: boolean;
  renderAttempts?: boolean;
  postScheduleSlots?: boolean;
  errors?: string[];
  warnings?: string[];
};

export const requiredSchemaChecks: Array<{
  key: keyof Omit<FanAgentSchemaDiagnostics, "errors">;
  label: string;
}> = [
  { key: "generationBatchesSettings", label: "generation_batches settings" },
  { key: "generationItemsQueueColumns", label: "generation_items queue columns" },
  { key: "workerRuns", label: "worker_runs" },
  { key: "audioClips", label: "audio_clips" },
  { key: "videoLibrary", label: "video_library_items" },
  { key: "sourceCandidates", label: "source_candidates" },
  { key: "sourceCandidateUses", label: "source_candidate_uses" },
  { key: "renderAttempts", label: "render_attempts" },
  { key: "postScheduleSlots", label: "post_schedule_slots" },
];

export function missingSchemaChecks(
  schema: FanAgentSchemaDiagnostics | null | undefined,
): string[] {
  if (!schema) return requiredSchemaChecks.map((check) => check.label);
  return requiredSchemaChecks
    .filter((check) => schema[check.key] !== true)
    .map((check) => check.label);
}

export function isFanAgentSchemaReady(
  schema: FanAgentSchemaDiagnostics | null | undefined,
): boolean {
  return missingSchemaChecks(schema).length === 0 && (schema?.errors?.length ?? 0) === 0;
}

export function schemaDiagnosticsSummary(
  schema: FanAgentSchemaDiagnostics | null | undefined,
): string {
  if (!schema) return "checking";
  if (schema.errors?.length) return schema.errors.join(" · ");
  const missing = missingSchemaChecks(schema);
  return missing.length ? `missing ${missing.join(" · ")}` : "ready";
}
