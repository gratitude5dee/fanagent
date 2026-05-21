type Category = {
  id: string;
  name: string;
  icon: string;
  children?: Category[];
};

const CATEGORIES: Category[] = [
  { id: "basketball", name: "Basketball", icon: "🏀", children: [{ id: "basketball-nba", name: "NBA", icon: "🏀" }, { id: "basketball-street", name: "Streetball", icon: "⛹️" }] },
  { id: "streamer", name: "Streamer", icon: "🎮", children: [{ id: "streamer-gaming", name: "Gaming", icon: "🕹️" }, { id: "streamer-reaction", name: "Reactions", icon: "💬" }] },
  { id: "stock", name: "Stock Footage", icon: "📽️", children: [{ id: "stock-city", name: "City", icon: "🌃" }, { id: "stock-nature", name: "Nature", icon: "🌲" }] },
  { id: "concert", name: "Concert", icon: "🎤" },
  { id: "lifestyle", name: "Lifestyle", icon: "✨" },
  { id: "cars", name: "Cars", icon: "🏎️" },
];

export type CategoryPickerProps = {
  value: string;
  randomize: boolean;
  onChange: (categoryId: string) => void;
  onRandomizeChange: (enabled: boolean) => void;
  poolCounts?: Record<string, number>;
};

export function categoryLabel(id: string): string {
  const all = CATEGORIES.flatMap((cat) => [cat, ...(cat.children ?? [])]);
  const found = all.find((cat) => cat.id === id);
  return found ? `${found.icon} ${found.name}` : id || "No category";
}

export default function CategoryPicker({
  value,
  randomize,
  onChange,
  onRandomizeChange,
  poolCounts = {},
}: CategoryPickerProps) {
  const selectedParent = CATEGORIES.find((cat) => cat.id === value || cat.children?.some((child) => child.id === value));

  return (
    <div className="stack">
      <label className="check category-randomize">
        <input
          type="checkbox"
          checked={randomize}
          onChange={(event) => onRandomizeChange(event.target.checked)}
        />{" "}
        Randomize clips from the full pool
      </label>
      <div className="category-grid" aria-disabled={randomize}>
        {CATEGORIES.map((cat) => {
          const selected = !randomize && (value === cat.id || cat.children?.some((child) => child.id === value));
          return (
            <button
              type="button"
              key={cat.id}
              className={`category-card ${selected ? "selected" : ""}`}
              onClick={() => {
                onRandomizeChange(false);
                onChange(cat.id);
              }}
              disabled={randomize}
            >
              <span className="category-icon">{cat.icon}</span>
              <strong>{cat.name}</strong>
              <span className="status-pill">{poolCounts[cat.id] ?? "—"} clips</span>
            </button>
          );
        })}
      </div>
      {!randomize && selectedParent?.children?.length ? (
        <div className="subcategory-row">
          {selectedParent.children.map((child) => (
            <button
              type="button"
              key={child.id}
              className={`button ${value === child.id ? "primary" : "ghost"}`}
              onClick={() => onChange(child.id)}
            >
              {child.icon} {child.name}
              <span className="status-pill">{poolCounts[child.id] ?? "—"}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

