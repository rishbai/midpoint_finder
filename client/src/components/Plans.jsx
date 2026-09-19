import { useEffect, useState } from 'react';
import { listPlans } from '../api.js';
import { formatWhen } from '../format.js';
import Avatar from './Avatar.jsx';
import NewPlan from './NewPlan.jsx';
import PlanDetail from './PlanDetail.jsx';

// What a plan needs from you right now, at a glance.
function planStatus(p) {
  if (p.my_status === 'invited') return { kind: 'invited', text: "You're invited" };
  if (p.shared_count >= 2) return { kind: 'ready', text: 'Ready to find spots' };
  const waiting = p.participant_count - p.shared_count;
  if (waiting > 0) return { kind: 'waiting', text: `Waiting on ${waiting}` };
  return { kind: 'muted', text: 'Just you so far' };
}

export default function Plans() {
  const [plans, setPlans] = useState([]);
  const [view, setView] = useState('list'); // 'list' | 'new'
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState('');

  const refresh = () => listPlans().then((d) => setPlans(d.plans)).catch((err) => setError(err.message));
  useEffect(() => {
    refresh();
  }, []);

  if (openId) {
    return (
      <PlanDetail
        id={openId}
        onBack={() => {
          setOpenId(null);
          refresh();
        }}
      />
    );
  }

  if (view === 'new') {
    return (
      <NewPlan
        onCreated={(id) => {
          setView('list');
          setOpenId(id);
        }}
        onCancel={() => setView('list')}
      />
    );
  }

  return (
    <section>
      <div className="page-head">
        <h2>Your plans</h2>
        <button type="button" className="primary" onClick={() => setView('new')}>+ New plan</button>
      </div>
      {error && <p className="notice">{error}</p>}

      {plans.length === 0 && (
        <div className="empty">
          <p className="empty-title">Nothing planned yet</p>
          <p className="muted">
            Start a plan, say what you're in the mood for, and invite friends — everyone shares where they are, and
            midpoint finds a spot that's fair for all of you.
          </p>
          <button type="button" className="primary" onClick={() => setView('new')}>Make your first plan</button>
        </div>
      )}

      <div className="plan-cards">
        {plans.map((p) => {
          const status = planStatus(p);
          const shown = Math.min(p.participant_count, 5);
          return (
            <button key={p.id} type="button" className="plan-card" onClick={() => setOpenId(p.id)}>
              <div className="plan-card-head">
                <span className="plan-card-title">{p.title}</span>
                <span className={`status-chip status-${status.kind}`}>{status.text}</span>
              </div>
              {(p.query_text || p.planned_for) && (
                <p className="plan-card-meta">
                  {p.query_text && <span>{p.query_text}</span>}
                  {p.query_text && p.planned_for && <span className="dot">·</span>}
                  {p.planned_for && <span>{formatWhen(p.planned_for)}</span>}
                </p>
              )}
              <div className="plan-card-foot">
                <span className="avatar-stack">
                  {Array.from({ length: shown }, (_, i) => <Avatar key={i} index={i} />)}
                  {p.participant_count > shown && <span className="avatar-more">+{p.participant_count - shown}</span>}
                </span>
                <span className="muted small">
                  {p.shared_count}/{p.participant_count} shared location · hosted by {p.host_name}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
