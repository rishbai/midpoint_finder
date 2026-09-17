import { createPlan } from '../api.js';
import PlanForm from './PlanForm.jsx';

export default function NewPlan({ onCreated, onCancel }) {
  async function handleSubmit(data) {
    const { plan } = await createPlan(data);
    onCreated(plan.id);
  }

  return (
    <section>
      <h2>New plan</h2>
      <PlanForm onSubmit={handleSubmit} onCancel={onCancel} submitLabel="Create plan" />
    </section>
  );
}
