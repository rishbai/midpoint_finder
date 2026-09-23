import { useEffect } from 'react';
import { label, price } from '../format.js';

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

// Vibes worth offering for a category, in the order someone would think of
// them. Everything is offered when no category is picked.
const VIBES_FOR = {
  bar: ['happy_hour', 'good_value', 'lively', 'late_night', 'outdoor_seating', 'date_night', 'good_for_groups', 'casual', 'upscale', 'cozy', 'quiet'],
  restaurant: ['date_night', 'good_for_groups', 'good_value', 'upscale', 'casual', 'cozy', 'quiet', 'lively', 'outdoor_seating', 'late_night', 'good_for_solo'],
  cafe: ['work_friendly', 'quiet', 'cozy', 'good_for_solo', 'outdoor_seating', 'casual', 'good_value', 'good_for_groups'],
};

// The filters currently applied, as one removable chip each. This is what
// stays on screen: only what's been chosen, never the whole menu.
export function activeChips(filters) {
  const chips = [];
  const add = (key, text, value) => chips.push({ key, text, value });
  if (filters.style) add('style', label(filters.style));
  else if (filters.category) add('category', label(filters.category));
  if (filters.cuisine) add('cuisine', label(filters.cuisine));
  (filters.vibes || []).forEach((v) => add('vibe', label(v), v));
  if (filters.maxPrice) add('maxPrice', price(filters.maxPrice));
  if (filters.minPrice) add('minPrice', `${price(filters.minPrice)} and up`);
  if (filters.minRating) add('minRating', `${filters.minRating}+ rating`);
  if (filters.openNow) add('openNow', 'Open now');
  if (filters.dish) add('dish', filters.dish);
  return chips;
}

export function removeChip(filters, chip) {
  switch (chip.key) {
    case 'style': return { ...filters, style: '' };
    case 'category': return { ...filters, category: '', style: '' };
    case 'vibe': return { ...filters, vibes: filters.vibes.filter((v) => v !== chip.value) };
    case 'openNow': return { ...filters, openNow: false };
    default: return { ...filters, [chip.key]: '' };
  }
}

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

// The "Filters" button plus the chips for whatever is active. Sits under a
// search field; opening the sheet is the only way to see the full menu.
export function FilterBar({ filters, onChange, onOpen }) {
  const chips = activeChips(filters);
  return (
    <div className="filter-row">
      <button type="button" className="filter-btn" onClick={onOpen} aria-haspopup="dialog">
        Filters{chips.length > 0 && <span className="filter-count">{chips.length}</span>}
      </button>
      {chips.map((c) => (
        <button
          key={c.key + (c.value || '')}
          type="button"
          className="active-chip"
          onClick={() => onChange(removeChip(filters, c))}
          aria-label={`Remove ${c.text}`}
        >
          {c.text}
          <span aria-hidden="true" className="active-chip-x">×</span>
        </button>
      ))}
      {chips.length > 0 && (
        <button type="button" className="link small" onClick={() => onChange(EMPTY_FILTERS)}>
          Clear
        </button>
      )}
    </div>
  );
}

// Everything, in a sheet: a bottom sheet on a phone, a centered dialog on a
// desktop. Options reveal progressively so it never reads as a wall: the
// kind of place only appears once a type is picked, cuisine only for
// restaurants, and the vibes are the ones that fit.
export default function FilterSheet({ meta, filters, onChange, onClose }) {
  const set = (key, value) => onChange({ ...filters, [key]: value });

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('sheet-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('sheet-open');
    };
  }, [onClose]);

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
  const count = activeChips(filters).length;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Filters">
        <div className="sheet-head">
          <h3>Filters</h3>
          <button type="button" className="link" onClick={onClose}>Done</button>
        </div>

        <section className="sheet-section">
          <p className="sheet-label">Type of place</p>
          <Pills options={meta.categories} value={filters.category} onPick={setCategory} any />
          {styles.length > 0 && (
            <>
              <p className="sheet-label sheet-sub">Kind of {label(filters.category)}</p>
              <Pills options={styles} value={filters.style} onPick={(v) => set('style', v)} any />
            </>
          )}
        </section>

        {showCuisine && (
          <section className="sheet-section">
            <p className="sheet-label">Cuisine</p>
            <select value={filters.cuisine} onChange={(e) => set('cuisine', e.target.value)}>
              <option value="">Any</option>
              {meta.cuisines.map((c) => (
                <option key={c} value={c}>{label(c)}</option>
              ))}
            </select>
          </section>
        )}

        <section className="sheet-section">
          <p className="sheet-label">Vibe</p>
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
        </section>

        <section className="sheet-section sheet-split">
          <div>
            <p className="sheet-label">Price</p>
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
          <div>
            <p className="sheet-label">Rating</p>
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
        </section>

        <section className="sheet-section sheet-split">
          <div>
            <p className="sheet-label">Hours</p>
            <div className="pills">
              <button type="button" className="pill" aria-pressed={filters.openNow} onClick={() => set('openNow', !filters.openNow)}>
                Open now
              </button>
            </div>
          </div>
          <div>
            <p className="sheet-label">Specific dish</p>
            <input
              type="text"
              placeholder="cacio e pepe"
              value={filters.dish}
              onChange={(e) => set('dish', e.target.value)}
            />
          </div>
        </section>

        <div className="sheet-foot">
          <button type="button" className="link" onClick={() => onChange(EMPTY_FILTERS)} disabled={!count}>
            Clear all
          </button>
          <button type="button" className="primary" onClick={onClose}>
            {count ? `Show with ${count} filter${count === 1 ? '' : 's'}` : 'Done'}
          </button>
        </div>
      </div>
    </>
  );
}
