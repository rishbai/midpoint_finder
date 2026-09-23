import { createPlan } from '../api.js';
import PlanForm from './PlanForm.jsx';

export default function NewPlan({ onCreated, onCancel }) {
  async function handleSubmit(data) {
    const { plan } = await createPlan(data);
    onCreated(plan.id);
  }

  return (
    <section>
      <button type="button" className="link back" onClick={onCancel}>&larr; Your plans</button>
      <div className="page-head">
        <h2>New plan</h2>
      </div>
      <PlanForm onSubmit={handleSubmit} onCancel={onCancel} submitLabel="Create plan" />
    </section>
  );
}
