import { useEffect, useState } from 'react';
import { searchVenues, parseQuery } from '../api.js';
import { summarizeFilters } from '../format.js';
import Filters, { EMPTY_FILTERS } from './Filters.jsx';
import VenueCard from './VenueCard.jsx';

export default function SearchView({ meta, filters, onFilters }) {
  const [ask, setAsk] = useState('');
  const [parsing, setParsing] = useState(false);
  const [askError, setAskError] = useState('');
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

  const interpreted = summarizeFilters(filters);

  return (
    <section>
      <form className="ask" onSubmit={submitAsk}>
        <input
          type="text"
          placeholder='Or describe it: "happy hour that goes past 7pm"'
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
        />
        <button type="submit" className="primary" disabled={parsing}>
          {parsing ? 'Thinking' : 'Ask'}
        </button>
      </form>
      {askError && <p className="notice">{askError}</p>}

      <Filters meta={meta} filters={filters} onChange={onFilters} />

      {status === 'error' ? (
        <p className="notice">Search failed: {error}</p>
      ) : (
        <>
          <p className="count">
            {status === 'loading' ? 'Searching' : `${results.length} places`}
            {interpreted && ` — showing ${interpreted}`}
          </p>
          {status === 'done' && results.length === 0 && (
            <p className="notice">Nothing matches. Remove a filter or two.</p>
          )}
          <div className="results">
            {results.map((v) => <VenueCard key={v.id} venue={v} />)}
          </div>
        </>
      )}
    </section>
  );
}
