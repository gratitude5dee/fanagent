import { Layers, Shuffle, Zap } from "lucide-react";
import type { CategoryNode, PoolCountIndex } from "@/lib/fanagent/categories";

type CategoryPickerProps = {
  categories: CategoryNode[];
  poolCounts: PoolCountIndex | null;
  categoryId: string;
  subcategorySlug: string;
  randomize: boolean;
  autoRender: boolean;
  requiredShots?: number;
  loading?: boolean;
  onCategoryId: (id: string) => void;
  onSubcategorySlug: (slug: string) => void;
  onRandomize: (value: boolean) => void;
  onAutoRender: (value: boolean) => void;
};

export function CategoryPicker(props: CategoryPickerProps) {
  const {
    categories,
    poolCounts,
    categoryId,
    subcategorySlug,
    randomize,
    autoRender,
    requiredShots = 1,
    loading,
  } = props;

  const selected = categories.find((c) => c.id === categoryId) ?? null;
  const subcategories = selected?.children ?? [];
  const hasSubs = subcategories.length > 0;

  const totalForCategory = (id: string) => (poolCounts ? poolCounts.totalForCategory(id) : 0);
  const exactCount =
    poolCounts && selected
      ? hasSubs && subcategorySlug
        ? poolCounts.get(selected.id, subcategorySlug)
        : poolCounts.totalForCategory(selected.id)
      : 0;

  const needed = Math.max(1, requiredShots);
  const poolEmpty = poolCounts != null && !randomize && selected != null && exactCount < 1;
  const poolUnderfilled =
    poolCounts != null && !randomize && selected != null && exactCount > 0 && exactCount < needed;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          opacity: 0.85,
        }}
      >
        <Layers size={12} /> Clip category
      </div>

      {loading ? (
        <div className="banner">Loading categories…</div>
      ) : (
        <div
          className="category-grid"
          role="radiogroup"
          aria-label="Clip category"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
            gap: 8,
          }}
        >
          {categories.map((cat) => {
            const active = cat.id === categoryId;
            const count = totalForCategory(cat.id);
            return (
              <button
                key={cat.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={randomize}
                onClick={() => {
                  props.onCategoryId(cat.id);
                  props.onSubcategorySlug("");
                }}
                className={`button ${active ? "primary" : "ghost"}`}
                style={{
                  flexDirection: "column",
                  alignItems: "flex-start",
                  padding: "10px 12px",
                  textAlign: "left",
                  height: "auto",
                  minHeight: 64,
                  gap: 4,
                  opacity: randomize ? 0.5 : 1,
                }}
              >
                <span style={{ fontWeight: 600 }}>
                  {cat.icon ? `${cat.icon} ` : ""}
                  {cat.name}
                </span>
                <span style={{ fontSize: 11, opacity: 0.75 }}>{count} clips</span>
              </button>
            );
          })}
        </div>
      )}

      {hasSubs ? (
        <label>
          Subcategory
          <select
            value={subcategorySlug}
            disabled={randomize}
            onChange={(e) => props.onSubcategorySlug(e.target.value)}
          >
            <option value="">All {selected?.name}</option>
            {subcategories.map((sub) => (
              <option key={sub.id} value={sub.slug}>
                {sub.name} ({poolCounts ? poolCounts.get(selected!.id, sub.slug) : 0})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="action-row" style={{ flexWrap: "wrap" }}>
        <label className="check" title="Sample stratified across all top-level categories">
          <input
            type="checkbox"
            checked={randomize}
            onChange={(e) => props.onRandomize(e.target.checked)}
          />{" "}
          <Shuffle size={12} /> Randomize across categories
        </label>
        <label className="check" title="Render straight to the Library — bypass scheduled posts">
          <input
            type="checkbox"
            checked={autoRender}
            onChange={(e) => props.onAutoRender(e.target.checked)}
          />{" "}
          <Zap size={12} /> Auto-render to library
        </label>
        {selected && !randomize ? (
          <span className="check" style={{ opacity: 0.75 }}>
            Pool: <strong style={{ marginLeft: 4 }}>{exactCount}</strong> clips eligible
          </span>
        ) : null}
      </div>

      {poolEmpty ? (
        <div className="banner warn">
          Selected category has no cached clips yet. The first run will populate the pool from
          live search before rendering. Sourcing is locked to {selected?.name} — no off-category
          stock will be mixed in.
        </div>
      ) : null}
      {poolUnderfilled ? (
        <div className="banner bad">
          Pool too small: {exactCount} cached clip{exactCount === 1 ? "" : "s"} for{" "}
          {selected?.name}, but this template needs {needed}. Enable Randomize, broaden the
          subcategory, or wait for the live search to backfill.
        </div>
      ) : null}
    </div>
  );
}
