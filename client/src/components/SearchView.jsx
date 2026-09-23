import { useEffect, useState } from 'react';
import { searchVenues, parseQuery } from '../api.js';
import FilterSheet, { EMPTY_FILTERS, FilterBar } from './Filters.jsx';
import LoadingOverlay from './LoadingOverlay.jsx';
import VenueCard from './VenueCard.jsx';

export default function SearchView({ meta, filters, onFilters }) {
  const [ask, setAsk] = useState('');
  const [parsing, setParsing] = useState(false);
  const [askError, setAskError] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    const timer = setTimeout(() => {
      searchVenues(filters)
        .then((data) => {
          if (cancelled) return;
          setResults(data.results);
          setStatus('done');
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err.message);
          setStatus('error');
        });
    }, 250); // wait for typing to settle
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filters]);

  async function submitAsk(e) {
    e.preventDefault();
    if (!ask.trim()) return;
    setParsing(true);
    setAskError('');
    try {
      const { filters: parsed } = await parseQuery(ask.trim());
      onFilters({ ...EMPTY_FILTERS, ...parsed });
    } catch (err) {
      setAskError(err.message);
    } finally {
      setParsing(false);
    }
  }

  return (
    <section>
      {parsing && <LoadingOverlay label="Reading what you're looking for" />}
      {sheetOpen && <FilterSheet meta={meta} filters={filters} onChange={onFilters} onClose={() => setSheetOpen(false)} />}

      <div className="page-head">
        <h2>Find a spot</h2>
      </div>

      <form className="search-hero" onSubmit={submitAsk}>
        <input
          type="text"
          placeholder="What are you in the mood for?"
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          aria-label="Describe what you're looking for"
        />
        <button type="submit" className="primary" disabled={parsing || !ask.trim()}>Search</button>
      </form>
      <FilterBar filters={filters} onChange={onFilters} onOpen={() => setSheetOpen(true)} />
      {askError && <p className="notice notice-error">{askError}</p>}

      {status === 'error' ? (
        <p className="notice notice-error">Search failed: {error}</p>
      ) : (
        <>
          <p className="count">{status === 'loading' ? 'Searching' : `${results.length} places`}</p>
          {status === 'done' && results.length === 0 && (
            <div className="empty">
              <p className="empty-title">Nothing matches</p>
              <p className="muted">Try removing a filter or two.</p>
            </div>
          )}
          <div className="results">
            {results.map((v) => <VenueCard key={v.id} venue={v} />)}
          </div>
        </>
      )}
    </section>
  );
}
