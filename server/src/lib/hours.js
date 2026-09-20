// Reads Google's regularOpeningHours JSON (stored verbatim on venues.hours)
// and answers "is this place open at this moment in the week?"
//
// periods look like: [{ open: {day,hour,minute}, close: {day,hour,minute} }, ...]
// day is 0=Sunday..6=Saturday. A period with no `close` runs 24 hours (open all week
// if it's the only period). A close on an earlier day/hour than open means it
// crosses midnight (e.g. open Fri 22:00, close Sat 02:00).
import tzlookup from 'tz-lookup';

const DAY_MINUTES = 24 * 60;
const WEEK_MINUTES = 7 * DAY_MINUTES;

function toWeekMinutes(point) {
  return point.day * DAY_MINUTES + point.hour * 60 + (point.minute || 0);
}

// target is { day, minutes } in the same 0=Sunday week-minute space.
export function isOpenAt(hoursJson, target) {
  const hours = typeof hoursJson === 'string' ? JSON.parse(hoursJson) : hoursJson;
  const periods = hours?.periods;
  if (!periods || !periods.length) return null; // unknown hours

  const t = target.day * DAY_MINUTES + target.minutes;

  for (const period of periods) {
    if (!period.open) continue;
    const start = toWeekMinutes(period.open);
    if (!period.close) return true; // runs continuously (24-hour place)
    let end = toWeekMinutes(period.close);
    if (end <= start) end += WEEK_MINUTES; // crosses midnight and/or the week boundary

    if (t >= start && t < end) return true;
    if (t + WEEK_MINUTES >= start && t + WEEK_MINUTES < end) return true; // wraparound check
  }
  return false;
}

// "7pm", "19:00", "7:30pm" -> minutes since midnight, or null if unparseable.
export function parseTimeOfDay(text) {
  const m = String(text).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] || 0);
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

// The latest moment any of this venue's happy hours is still running, from
// the JSON in venues.hh_windows (see db.js). Ends past midnight are stored
// beyond 1440, so this compares directly against a "still on at X" target.
export function latestHappyHourEnd(windowsJson) {
  if (!windowsJson) return null;
  try {
    const windows = typeof windowsJson === 'string' ? JSON.parse(windowsJson) : windowsJson;
    if (!Array.isArray(windows) || !windows.length) return null;
    return Math.max(...windows.map((w) => w.end));
  } catch {
    return null;
  }
}

export const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function dayIndex(name) {
  const i = DAY_NAMES.indexOf(String(name).toLowerCase());
  return i === -1 ? null : i;
}

// A venue's hours are meaningless without knowing its *local* wall-clock
// time — a bar in LA "closing at 2am" is a different moment than one in NYC.
// Used with each venue's own lat/lng wherever possible (see search.js).
// Falls back to Eastern only when no location is known yet at all (e.g.
// resolving "today" while parsing free text, before anyone's said where
// they are — see services/query.js; a day-of-week guess off by the width of
// one timezone near midnight is an acceptable imprecision there, since the
// actual open/closed filtering below is always done with the real location).
const FALLBACK_TIMEZONE = 'America/New_York';

export function dayAndMinutesAt(date = new Date(), lat, lng) {
  let timeZone = FALLBACK_TIMEZONE;
  if (lat != null && lng != null) {
    try {
      timeZone = tzlookup(lat, lng);
    } catch {
      // Off the coast, over water, etc. — fall back rather than throw.
    }
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const hour = Number(parts.hour) % 24;
  return { day, minutes: hour * 60 + Number(parts.minute) };
}
