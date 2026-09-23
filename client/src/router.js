import { useEffect, useState } from 'react';

// The URL is the source of truth for where you are in the app, so a browser
// refresh lands you back on the same plan, tab, or form instead of the plans
// list. No router library: there are half a dozen paths and they don't nest.
//
//   /              plans list          /plans/new       new plan
//   /plans/:id     one plan            /plans/:id/edit  editing it
//   /search        find a spot         /friends         friends
//   /join/:token   invite landing      /add-friend/:token

const listeners = new Set();

export function navigate(path, { replace = false } = {}) {
  if (path === window.location.pathname) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
  listeners.forEach((fn) => fn(path));
}

export function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onChange = () => setPath(window.location.pathname);
    listeners.add(onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);
  return path;
}

const PLAN = /^\/plans\/([^/]+)(?:\/(edit))?\/?$/;

export function parsePath(path) {
  if (path === '/' || path === '/plans' || path === '/plans/') return { tab: 'plans' };
  if (path === '/plans/new') return { tab: 'plans', newPlan: true };
  const plan = path.match(PLAN);
  if (plan) return { tab: 'plans', planId: plan[1], editing: plan[2] === 'edit' };
  if (path.startsWith('/search')) return { tab: 'search' };
  if (path.startsWith('/friends')) return { tab: 'friends' };
  return { tab: 'plans' };
}
