// Single chokepoint for resolving which clips are eligible for a campaign/remix.
// Category isolation is treated as a security property: a basketball edit MUST
// only contain basketball clips. Never widen the filter. If the pool is empty,
// surface that to the caller — never silently substitute.

// Use any for the supabase client type — Deno-only npm: imports break vitest type-check.
type SupabaseClient = any;
// Lazy supabase import keeps pure helpers importable from vitest without
// dragging in Deno-only npm: modules.
async function lazyAdmin(): Promise<SupabaseClient> {
  const mod = await import("../supabase.ts");
  return mod.getSupabaseAdmin();
}
import type { SourceCandidate, SourceType } from "./types.ts";

export type ClipCategory = {
  id: string;
  slug: string;
  name: string;
  parent_id: string | null;
  source_type: SourceType;
};

export type PoolFilters = {
  minDurationSec?: number;
  maxDurationSec?: number;
  portraitOnly?: boolean;
  tagWhitelist?: string[];
  tagBlacklist?: string[];
  motionMin?: number;
  faceRequired?: boolean;
};

export type PoolRequest = {
  accountId: string;
  categoryId?: string | null;
  subcategorySlug?: string | null;
  randomize?: boolean;
  filters?: PoolFilters;
  limit?: number;
};

export class CategoryIsolationViolation extends Error {
  constructor(
    public expected: { categoryId: string; subcategorySlug: string | null },
    public actual: { id: string; categoryId: string | null; subcategorySlug: string | null },
  ) {
    super(
      `Category isolation violated: candidate ${actual.id} (category=${actual.categoryId}, sub=${actual.subcategorySlug}) does not match expected (category=${expected.categoryId}, sub=${expected.subcategorySlug})`,
    );
  }
}

export class InsufficientPoolError extends Error {
  constructor(
    public categoryId: string,
    public available: number,
    public required: number,
  ) {
    super(`Pool too small: have ${available} clips, need ${required}`);
  }
}

const categoryCache = new Map<string, ClipCategory>();

export async function getCategoryById(
  id: string,
  client?: SupabaseClient,
): Promise<ClipCategory | null> {
  if (categoryCache.has(id)) return categoryCache.get(id)!;
  const supabase = client ?? (await lazyAdmin());
  const { data, error } = await supabase
    .from("clip_categories")
    .select("id,slug,name,parent_id,source_type")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const cat = data as ClipCategory;
  categoryCache.set(id, cat);
  return cat;
}

export async function getCategoryBySlug(
  slug: string,
  client?: SupabaseClient,
): Promise<ClipCategory | null> {
  const supabase = client ?? (await lazyAdmin());
  const { data, error } = await supabase
    .from("clip_categories")
    .select("id,slug,name,parent_id,source_type")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const cat = data as ClipCategory;
  categoryCache.set(cat.id, cat);
  return cat;
}

export async function listAllCategories(
  client?: SupabaseClient,
): Promise<ClipCategory[]> {
  const { data, error } = await supabase
    .from("clip_categories")
    .select("id,slug,name,parent_id,source_type")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ClipCategory[];
}

function applyFilters(
  query: ReturnType<SupabaseClient["from"]>,
  filters: PoolFilters | undefined,
): ReturnType<SupabaseClient["from"]> {
  if (!filters) return query;
  let q: any = query;
  if (typeof filters.minDurationSec === "number") {
    q = q.gte("duration_seconds", filters.minDurationSec);
  }
  if (typeof filters.maxDurationSec === "number") {
    q = q.lte("duration_seconds", filters.maxDurationSec);
  }
  if (filters.portraitOnly) {
    q = q.eq("is_portrait", true);
  }
  return q;
}

/**
 * Resolve the eligible clip pool. Single chokepoint — DO NOT bypass.
 * Returns DB-cached source_candidates only. Live external search happens via
 * source-candidate-search; this resolver only sees what's already ingested.
 */
export async function selectClipPool(req: PoolRequest): Promise<SourceCandidate[]> {
  const supabase = getSupabaseAdmin();

  if (req.randomize) {
    return stratifiedSampleAcrossCategories(req);
  }

  if (!req.categoryId) {
    throw new Error("selectClipPool requires categoryId unless randomize=true");
  }

  let query: any = supabase
    .from("source_candidates")
    .select("*")
    .eq("account_id", req.accountId)
    .eq("category_id", req.categoryId);

  if (req.subcategorySlug) {
    query = query.eq("subcategory_slug", req.subcategorySlug);
  }

  query = applyFilters(query, req.filters);

  query = query.or("expires_at.is.null,expires_at.gt." + new Date().toISOString());
  query = query.limit(req.limit ?? 500);

  const { data, error } = await query;
  if (error) throw error;

  const pool = (data ?? []) as SourceCandidate[];
  // Defensive double-check the DB honored our filters.
  assertPoolIsolation(pool, req.categoryId, req.subcategorySlug ?? null);
  return pool;
}

/**
 * Sample roughly proportional counts across every category the account has clips in.
 * Stratifies by PARENT category_id (sport subcategories collapse into their parent).
 */
export async function stratifiedSampleAcrossCategories(
  req: PoolRequest,
): Promise<SourceCandidate[]> {
  const supabase = getSupabaseAdmin();
  const limit = req.limit ?? 500;

  // Get all parent categories with available clips for this account.
  const { data: counts, error } = await supabase
    .from("view_clip_pool_counts")
    .select("category_id, clip_count")
    .eq("account_id", req.accountId);
  if (error) throw error;

  const byCategory = new Map<string, number>();
  for (const row of (counts ?? []) as Array<{ category_id: string; clip_count: number }>) {
    byCategory.set(row.category_id, (byCategory.get(row.category_id) ?? 0) + Number(row.clip_count));
  }
  if (byCategory.size === 0) return [];

  const total = Array.from(byCategory.values()).reduce((sum, n) => sum + n, 0);
  const out: SourceCandidate[] = [];

  for (const [categoryId, count] of byCategory) {
    const share = Math.max(1, Math.floor((count / total) * limit));
    let q: any = supabase
      .from("source_candidates")
      .select("*")
      .eq("account_id", req.accountId)
      .eq("category_id", categoryId)
      .limit(share);
    q = applyFilters(q, req.filters);
    const { data, error: e2 } = await q;
    if (e2) throw e2;
    out.push(...((data ?? []) as SourceCandidate[]));
  }

  // Fisher-Yates shuffle for randomness within the stratified pool.
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Guard called immediately after pool fetch and again after candidate selection.
 * Throws CategoryIsolationViolation on any leak. This is the security boundary.
 */
export function assertPoolIsolation(
  candidates: SourceCandidate[],
  expectedCategoryId: string,
  expectedSubcategorySlug: string | null,
): void {
  for (const c of candidates) {
    assertCandidateInCategory(c, expectedCategoryId, expectedSubcategorySlug);
  }
}

export function assertCandidateInCategory(
  candidate: SourceCandidate,
  expectedCategoryId: string,
  expectedSubcategorySlug: string | null,
): void {
  const actualCat = (candidate as any).category_id ?? null;
  const actualSub = (candidate as any).subcategory_slug ?? null;
  if (actualCat !== expectedCategoryId) {
    throw new CategoryIsolationViolation(
      { categoryId: expectedCategoryId, subcategorySlug: expectedSubcategorySlug },
      { id: candidate.id ?? "(unsaved)", categoryId: actualCat, subcategorySlug: actualSub },
    );
  }
  if (expectedSubcategorySlug && actualSub !== expectedSubcategorySlug) {
    throw new CategoryIsolationViolation(
      { categoryId: expectedCategoryId, subcategorySlug: expectedSubcategorySlug },
      { id: candidate.id ?? "(unsaved)", categoryId: actualCat, subcategorySlug: actualSub },
    );
  }
}
