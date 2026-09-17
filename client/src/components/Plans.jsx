import { useEffect, useState } from 'react';
import { listPlans } from '../api.js';
import NewPlan from './NewPlan.jsx';
import PlanDetail from './PlanDetail.jsx';

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
      <div className="people-actions">
        <h2>Plans</h2>
        <button type="button" className="primary" onClick={() => setView('new')}>New plan</button>
      </div>
      {error && <p className="notice">{error}</p>}
      {plans.length === 0 && (
        <p className="notice">No plans yet. Start one and invite friends to share their location.</p>
      )}
      <ul className="plain-list">
        {plans.map((p) => (
          <li key={p.id}>
            <button type="button" className="plan-row" onClick={() => setOpenId(p.id)}>
              <strong>{p.title}</strong>
              <span className="muted">
                {' '}
                hosted by {p.host_name} · {p.shared_count}/{p.participant_count} shared location
              </span>
              {p.my_status === 'invited' && (
                <span className="chip" aria-pressed="true" style={{ marginLeft: '0.5rem' }}>
                  Invited
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
