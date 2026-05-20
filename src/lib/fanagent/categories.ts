// Categorized Clip Library — frontend types & loaders.
// Categories are the user-facing source pickers; each category maps to a
// `source_type` that the rest of the pipeline understands (sourceMode).

import { supabase } from "@/integrations/supabase/client";
import type { SourceMode } from "./sourceMode";

export type ClipCategory = {
  id: string;
  slug: string;
  name: string;
  parent_id: string | null;
  source_type: string;
  icon: string | null;
  sort_order: number;
};

export type CategoryNode = ClipCategory & {
  children: ClipCategory[];
};

export type PoolCountRow = {
  account_id: string | null;
  category_id: string | null;
  subcategory_slug: string | null;
  clip_count: number;
};

export type PoolCountIndex = {
  // key: `${category_id}::${subcategory_slug ?? ""}` → clip count (account + shared)
  get(categoryId: string, subcategorySlug?: string | null): number;
  totalForCategory(categoryId: string): number;
};

export function categoryToSourceMode(category: Pick<ClipCategory, "source_type">): SourceMode {
  switch (category.source_type) {
    case "seedance":
      return "seedance";
    case "gmi_seedance":
      return "gmi_seedance";
    case "sports_edit":
      return "sports_edit";
    case "streamer_clip":
      return "streamer_clip";
    case "library":
    case "stock":
    default:
      return "stock";
  }
}

export async function fetchClipCategories(): Promise<CategoryNode[]> {
  const { data, error } = await supabase
    .from("clip_categories")
    .select("id,slug,name,parent_id,source_type,icon,sort_order")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as ClipCategory[];
  const parents = rows.filter((r) => !r.parent_id);
  const byParent = new Map<string, ClipCategory[]>();
  for (const r of rows) {
    if (!r.parent_id) continue;
    const arr = byParent.get(r.parent_id) ?? [];
    arr.push(r);
    byParent.set(r.parent_id, arr);
  }
  return parents.map((p) => ({
    ...p,
    children: (byParent.get(p.id) ?? []).sort((a, b) => a.sort_order - b.sort_order),
  }));
}

export async function fetchPoolCounts(accountId: string | null): Promise<PoolCountIndex> {
  // The view aggregates by (account_id, category_id, subcategory_slug). Pull
  // both account-scoped and shared (account_id IS NULL) rows so the picker
  // shows the true eligible pool for this account.
  const { data, error } = await supabase
    .from("view_clip_pool_counts")
    .select("account_id,category_id,subcategory_slug,clip_count");
  if (error) throw error;
  const rows = (data ?? []) as PoolCountRow[];
  const relevant = rows.filter(
    (r) => r.account_id === null || (accountId && r.account_id === accountId),
  );
  const exact = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const row of relevant) {
    if (!row.category_id) continue;
    const key = `${row.category_id}::${row.subcategory_slug ?? ""}`;
    exact.set(key, (exact.get(key) ?? 0) + Number(row.clip_count ?? 0));
    totals.set(row.category_id, (totals.get(row.category_id) ?? 0) + Number(row.clip_count ?? 0));
  }
  return {
    get(categoryId, subcategorySlug) {
      const key = `${categoryId}::${subcategorySlug ?? ""}`;
      return exact.get(key) ?? 0;
    },
    totalForCategory(categoryId) {
      return totals.get(categoryId) ?? 0;
    },
  };
}
