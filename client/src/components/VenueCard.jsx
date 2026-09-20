import { label, price, happyHourLabel } from '../format.js';

// Google's 5-star rating, rescaled to a 0-10 score badge (Beli-style).
function scoreClass(score) {
  if (score >= 8.5) return 'score-great';
  if (score >= 7) return 'score-good';
  if (score >= 5.5) return 'score-average';
  return 'score-low';
}

export default function VenueCard({ venue, children }) {
  const details = [label(venue.category), label(venue.cuisine), price(venue.price_level)]
    .filter(Boolean)
    .join(' · ');
  const score = venue.rating ? Math.round(venue.rating * 2 * 10) / 10 : null;
  const happyHour = happyHourLabel(venue.hh_windows);

  return (
    <article className="venue">
      {score != null && (
        <span className={`score ${scoreClass(score)}`} title={`${venue.rating} / 5 on Google`}>
          {score.toFixed(1)}
        </span>
      )}
      <div className="venue-body">
        <div className="venue-head">
          <h3>{venue.name}</h3>
          {venue.rating_count ? (
            <span className="muted small">({venue.rating_count.toLocaleString()})</span>
          ) : null}
        </div>
        <p className="details">{details}</p>
        <p className="address">{venue.address}</p>
        {venue.description ? (
          // Grounded in this venue's actual reviews and what was asked for
          // (see server/src/services/describe.js) — takes priority over the
          // generic dish/vibe line below since it's more specific.
          <p className="highlight">{venue.description}</p>
        ) : (
          venue.dishes.length > 0 && <p className="dishes">Known for {venue.dishes.slice(0, 4).join(', ')}</p>
        )}
        {happyHour && <p className="hh-badge">{happyHour}</p>}
        {venue.vibes.length > 0 && <p className="tags">{venue.vibes.map(label).join(', ')}</p>}
        {children}
      </div>
    </article>
  );
}
