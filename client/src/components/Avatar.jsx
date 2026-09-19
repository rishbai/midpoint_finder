import { personLetter } from '../format.js';

// Colored initial bubble. `index` picks the color (and, in a plan, the
// letter A/B/C… that matches that person's map pin); pass `label` to show a
// name's initial instead, e.g. in the Friends list where there's no plan.
export default function Avatar({ index = 0, label, size }) {
  return (
    <span className={`avatar${size === 'lg' ? ' avatar-lg' : ''}`} aria-hidden="true" data-i={index % 6}>
      {label ?? personLetter(index)}
    </span>
  );
}
