import { label } from '../format.js';

export const EMPTY_FILTERS = {
  category: '',
  cuisine: '',
  minPrice: '',
  maxPrice: '',
  minRating: '',
  dish: '',
  vibes: [],
  openNow: false,
};

const RATINGS = [4, 4.3, 4.5, 4.7];
const PRICES = [1, 2, 3, 4];

export default function Filters({ meta, filters, onChange }) {
  const set = (key, value) => onChange({ ...filters, [key]: value });

  return (
    <div className="filter-bar">
      <div className="filter-group">
        <span className="filter-label">Type</span>
        <div className="pills">
          <button type="button" className="pill" aria-pressed={!filters.category} onClick={() => set('category', '')}>
            Any
          </button>
          {meta.categories.map((c) => (
            <button
              key={c}
              type="button"
              className="pill"
              aria-pressed={filters.category === c}
              onClick={() => set('category', filters.category === c ? '' : c)}
            >
              {label(c)}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <span className="filter-label">Cuisine</span>
        <select value={filters.cuisine} onChange={(e) => set('cuisine', e.target.value)}>
          <option value="">Any</option>
          {meta.cuisines.map((c) => (
            <option key={c} value={c}>{label(c)}</option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <span className="filter-label">Price</span>
        <div className="pills">
          {PRICES.map((n) => (
            <button
              key={n}
              type="button"
              className="pill"
              aria-pressed={filters.maxPrice === n}
              onClick={() => set('maxPrice', filters.maxPrice === n ? '' : n)}
            >
              {'$'.repeat(n)}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <span className="filter-label">Rating</span>
        <div className="pills">
          {RATINGS.map((n) => (
            <button
              key={n}
              type="button"
              className="pill"
              aria-pressed={filters.minRating === n}
              onClick={() => set('minRating', filters.minRating === n ? '' : n)}
            >
              {n}+
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <span className="filter-label">Hours</span>
        <div className="pills">
          <button
            type="button"
            className="pill"
            aria-pressed={filters.openNow}
            onClick={() => set('openNow', !filters.openNow)}
          >
            Open now
          </button>
        </div>
      </div>

      <div className="filter-group grow">
        <span className="filter-label">Dish or drink</span>
        <input
          type="text"
          placeholder="cacio e pepe, espresso tonic"
          value={filters.dish}
          onChange={(e) => set('dish', e.target.value)}
        />
      </div>

      <button type="button" className="link" onClick={() => onChange(EMPTY_FILTERS)}>
        Clear filters
      </button>
    </div>
  );
}
