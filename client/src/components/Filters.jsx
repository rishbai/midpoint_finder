import { label } from '../format.js';

export const EMPTY_FILTERS = {
  category: '',
  style: '',
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

// Vibes that make sense to offer for a given category, in the order someone
// would think of them. All of them still apply if no category is picked.
const VIBES_FOR = {
  bar: ['happy_hour', 'good_value', 'lively', 'late_night', 'outdoor_seating', 'date_night', 'good_for_groups', 'casual', 'upscale', 'cozy', 'quiet'],
  restaurant: ['date_night', 'good_for_groups', 'good_value', 'upscale', 'casual', 'cozy', 'quiet', 'lively', 'outdoor_seating', 'late_night', 'good_for_solo'],
  cafe: ['work_friendly', 'quiet', 'cozy', 'good_for_solo', 'outdoor_seating', 'casual', 'good_value', 'good_for_groups'],
};

function Pills({ options, value, onPick, any }) {
  return (
    <div className="pills">
      {any && (
        <button type="button" className="pill" aria-pressed={!value} onClick={() => onPick('')}>
          Any
        </button>
      )}
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className="pill"
          aria-pressed={value === o}
          onClick={() => onPick(value === o ? '' : o)}
        >
          {label(o)}
        </button>
      ))}
    </div>
  );
}

export default function Filters({ meta, filters, onChange }) {
  const set = (key, value) => onChange({ ...filters, [key]: value });

  // Picking a category narrows what's on offer below it, and anything that
  // only made sense under the old category is dropped rather than carried
  // along silently (a "pub" kind under "restaurant" would match nothing).
  function setCategory(category) {
    onChange({
      ...filters,
      category,
      style: '',
      cuisine: category && category !== 'restaurant' ? '' : filters.cuisine,
    });
  }

  function toggleVibe(v) {
    const vibes = filters.vibes.includes(v) ? filters.vibes.filter((x) => x !== v) : [...filters.vibes, v];
    set('vibes', vibes);
  }

  const styles = filters.category ? meta.styles?.[filters.category] || [] : [];
  const vibes = filters.category ? VIBES_FOR[filters.category] || meta.vibes : meta.vibes;
  const showCuisine = !filters.category || filters.category === 'restaurant';

  return (
    <div className="filter-bar">
      <div className="filter-group">
        <span className="filter-label">Type</span>
        <Pills options={meta.categories} value={filters.category} onPick={setCategory} any />
      </div>

      {styles.length > 0 && (
        <div className="filter-group">
          <span className="filter-label">Kind of {label(filters.category)}</span>
          <Pills options={styles} value={filters.style} onPick={(v) => set('style', v)} any />
        </div>
      )}

      {showCuisine && (
        <div className="filter-group">
          <span className="filter-label">Cuisine</span>
          <select value={filters.cuisine} onChange={(e) => set('cuisine', e.target.value)}>
            <option value="">Any</option>
            {meta.cuisines.map((c) => (
              <option key={c} value={c}>{label(c)}</option>
            ))}
          </select>
        </div>
      )}

      <div className="filter-group grow">
        <span className="filter-label">Vibe</span>
        <div className="pills">
          {vibes.map((v) => (
            <button
              key={v}
              type="button"
              className="pill"
              aria-pressed={filters.vibes.includes(v)}
              onClick={() => toggleVibe(v)}
            >
              {label(v)}
            </button>
          ))}
        </div>
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
          <button type="button" className="pill" aria-pressed={filters.openNow} onClick={() => set('openNow', !filters.openNow)}>
            Open now
          </button>
        </div>
      </div>

      <div className="filter-group grow">
        <span className="filter-label">Specific dish</span>
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
