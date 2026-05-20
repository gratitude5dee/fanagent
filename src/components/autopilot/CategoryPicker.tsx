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
    <div className="stack" style={{ gap: 8 }}>
      <div className="split">
        <label>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Layers size={12} /> Clip category
          </span>
          <select
            value={categoryId}
            disabled={loading || randomize}
            onChange={(e) => {
              props.onCategoryId(e.target.value);
              props.onSubcategorySlug("");
            }}
          >
            <option value="">
              {loading ? "Loading categories…" : "Select a category"}
            </option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name} ({totalForCategory(cat.id)})
              </option>
            ))}
          </select>
        </label>
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
        ) : (
          <div />
        )}
      </div>

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

      {insufficientPool ? (
        <div className="banner warn">
          Selected category has no cached clips yet. The first run will populate the pool from live
          search before rendering.
        </div>
      ) : null}
    </div>
  );
}
