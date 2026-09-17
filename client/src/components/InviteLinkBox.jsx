import { useState } from 'react';

// A copyable link, with a graceful fallback when the Clipboard API is
// unavailable/denied — the field is always readonly + selectable by hand.
export default function InviteLinkBox({ label, url }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignored — the input below still works for a manual copy
    }
  }

  return (
    <div className="invite-link">
      <label>
        {label}
        <div className="invite-link-row">
          <input type="text" readOnly value={url} onFocus={(e) => e.target.select()} />
          <button type="button" className="link" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
        </div>
      </label>
    </div>
  );
}
