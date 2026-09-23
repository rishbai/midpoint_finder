// Greys out the page and says what's happening, for the few things that
// genuinely take a moment: reading a description, checking travel times,
// saving a location. Rendered on top of everything so it's obvious the app
// is working rather than stuck, and so nothing gets double-submitted.
export default function LoadingOverlay({ label = 'Working' }) {
  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-box">
        <span className="spinner" aria-hidden="true" />
        <span>{label}</span>
      </div>
    </div>
  );
}
