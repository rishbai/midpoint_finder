import { Capacitor } from '@capacitor/core';
import { supabase, SUPABASE_ENABLED } from './supabase.js';

// Empty in dev (Vite proxies /api to the local server, same origin) and on
// the website (Vercel proxies /api to the API, see vercel.json). The native
// app has no proxy in front of it, so it needs the API's real address.
const NATIVE = Capacitor.isNativePlatform();
const API_BASE =
  import.meta.env.VITE_API_URL || (NATIVE ? 'https://midpoint-api-production.up.railway.app' : '');

// With Supabase login, every request carries the current access token; the
// server verifies it and finds (or creates) the person behind it. Without
// it, the cookie session does the same job.
async function authHeaders() {
  if (!SUPABASE_ENABLED) return {};
  const { data } = await supabase.auth.getSession();
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

async function request(path, options = {}) {
  const headers = { ...(await authHeaders()), ...(options.headers || {}) };
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function postJson(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function toQuery(filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === '' || value == null) continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
    } else {
      params.set(key, value);
    }
  }
  return params.toString();
}

export const getMeta = () => request('/api/meta');

export const searchVenues = (filters) => request(`/api/venues?${toQuery(filters)}`);

export const findMeetup = (addresses, filters) => postJson('/api/meetup', { addresses, filters });

// Turns free text ("good Indian food, open past 9pm") into structured filters.
export const parseQuery = (q) => postJson('/api/query', { q });

// Auth
export const getMe = () => request('/api/auth/me');
export const updateProfile = (name) =>
  request('/api/auth/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
export const deleteAccount = () => request('/api/auth/me', { method: 'DELETE' });
export const signup = (body) => postJson('/api/auth/signup', body);
export const login = (body) => postJson('/api/auth/login', body);
export const logout = () => request('/api/auth/logout', { method: 'POST' });
export const upgradeAccount = (body) => postJson('/api/auth/upgrade', body);

// Friends
export const getFriends = () => request('/api/friends');
export const searchUsers = (email) => request(`/api/users/search?email=${encodeURIComponent(email)}`);
export const sendFriendRequest = (email) => postJson('/api/friends/requests', { email });
export const acceptFriendRequest = (id) => request(`/api/friends/requests/${id}/accept`, { method: 'POST' });
export const declineFriendRequest = (id) => request(`/api/friends/requests/${id}/decline`, { method: 'POST' });
export const getFriendInvitePreview = (token) => request(`/api/friends/invite/${token}`);
export const acceptFriendInvite = (token) => request(`/api/friends/invite/${token}`, { method: 'POST' });

// Plans (invite friends, share location, find the midpoint)
export const listPlans = () => request('/api/plans');
export const createPlan = (body) => postJson('/api/plans', body);
export const getPlan = (id) => request(`/api/plans/${id}`);
export const updatePlan = (id, body) =>
  request(`/api/plans/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
export const deletePlan = (id) => request(`/api/plans/${id}`, { method: 'DELETE' });
export const invitePlan = (id, friendIds) => postJson(`/api/plans/${id}/invite`, { friendIds });

// Adds someone with no account: the host supplies a name and where they're
// coming from, and they count in the ranking like anyone else.
export const addPersonToPlan = (id, person) => postJson(`/api/plans/${id}/people`, person);

// How one person travels for THIS plan — the same person can take the subway
// at home and drive when they're visiting family.
export const setPlanTravelModes = (id, userId, travelModes) =>
  request(`/api/plans/${id}/participants/${userId}/travel-modes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ travelModes }),
  });
export const leavePlan = (id) => request(`/api/plans/${id}/leave`, { method: 'POST' });
export const removeFromPlan = (id, userId) =>
  request(`/api/plans/${id}/participants/${userId}`, { method: 'DELETE' });
export const respondToPlan = (id, action) => postJson(`/api/plans/${id}/respond`, { action });
export const sharePlanLocation = (id, body) => postJson(`/api/plans/${id}/location`, body);
export const getPlanResults = (id) => request(`/api/plans/${id}/results`);
export const getPlanVenueRoutes = (id, venueId) => request(`/api/plans/${id}/routes/${venueId}`);

// Invite links (no account needed to preview or join)
export const getPlanPreview = (token) => request(`/api/plans/join/${token}`);
export const joinPlan = (token, travelModes) => postJson(`/api/plans/join/${token}`, { travelModes });
