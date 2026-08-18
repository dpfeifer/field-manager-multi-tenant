// IANA timezone handling for organizations.
//
// Validation leans on the runtime's own tz database rather than a hardcoded
// list, so it stays correct as zones are added or renamed — Intl throws a
// RangeError for anything it doesn't recognise.

const DEFAULT_TIMEZONE = 'America/New_York';

function isValidTimezone(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() });
    return true;
  } catch (err) {
    return false;
  }
}

// Falls back to the default rather than throwing, for callers that would
// rather store something sane than fail (e.g. a signup carrying a browser
// timezone we don't recognise).
function normalizeTimezone(tz) {
  return isValidTimezone(tz) ? tz.trim() : DEFAULT_TIMEZONE;
}

// 'YYYY-MM-DD' and 0–23 hour as they currently read in the given zone. The
// reminder job uses this to decide whether it's that org's send hour, and
// which day counts as "tomorrow" for them.
function localDateParts(timezone, at = new Date()) {
  const tz = normalizeTimezone(timezone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false,
  }).formatToParts(at).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
  };
}

module.exports = { DEFAULT_TIMEZONE, isValidTimezone, normalizeTimezone, localDateParts };
