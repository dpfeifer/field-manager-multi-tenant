/*
 * Recurrence + occurrence math — the single source of truth for "when does
 * this job actually happen", shared by the browser and the server.
 *
 * The browser loads this with a plain <script> tag before the app bundle, so
 * these land as globals the app can call. Node require()s it directly via the
 * guarded export at the bottom. One file, so a change to the rules (a new
 * recurrence pattern, say) reaches the calendar and any server-side job in the
 * same commit — rather than the calendar showing visits a cron never sees.
 *
 * Keep this dependency-free and free of DOM/Node APIs so both hosts can run it.
 *
 * Dates are handled as local-time calendar dates ('YYYY-MM-DD'), never UTC
 * instants: a visit on the 19th is the 19th regardless of the viewer's clock.
 */

function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date, n) {
  const r = new Date(date);
  r.setDate(r.getDate() + n);
  return r;
}

function addMonths(date, n) {
  const r = new Date(date);
  const day = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + n);
  const daysInMonth = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, daysInMonth));
  return r;
}

function todayStart() {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

// Raw pattern dates from start_date up to `limit`, ignoring skips/reschedules.
function generatePatternDates(job, limit) {
  const start = parseDate(job.start_date);
  const end = job.end_date ? parseDate(job.end_date) : null;
  const out = [];
  let current = new Date(start);
  for (let i = 0; i < 520; i++) {
    if (end && current > end) break;
    if (current > limit) break;
    out.push(formatYMD(current));
    if (job.recurrence_pattern === 'weekly') current = addDays(current, 7);
    else if (job.recurrence_pattern === 'biweekly') current = addDays(current, 14);
    else if (job.recurrence_pattern === 'monthly') current = addMonths(current, 1);
    else break;
  }
  return out;
}

// Apply reschedules, skips and deletions to a raw pattern. Shared by both
// occurrence readers so the adjustments can't diverge between them.
function applyDateAdjustments(job, dates) {
  const set = new Set(dates);
  const rescheduled = (job.rescheduled_dates && typeof job.rescheduled_dates === 'object')
    ? job.rescheduled_dates : {};
  const rescheduledFrom = {};
  Object.entries(rescheduled).forEach(([orig, target]) => {
    set.delete(orig);
    set.add(target);
    rescheduledFrom[target] = orig;
  });
  (job.skipped_dates || []).forEach((d) => set.delete(d));
  (job.deleted_dates || []).forEach((d) => set.delete(d));
  return { set, rescheduledFrom };
}

// Occurrences for a recurring job from `today` out `horizonDays`.
function computeOccurrences(job, today = todayStart(), horizonDays = 365) {
  if (job.type !== 'recurring' || !job.start_date) return [];
  const limit = addDays(today, horizonDays);
  const { set, rescheduledFrom } = applyDateAdjustments(job, generatePatternDates(job, limit));
  const completed = new Set(job.completed_dates || []);

  return [...set].sort().map((date) => ({
    date,
    completed: completed.has(date),
    rescheduledFrom: rescheduledFrom[date] || null,
  }));
}

function nextDueDate(job, today = todayStart()) {
  const todayStr = formatYMD(today);
  const upcoming = computeOccurrences(job, today).filter((o) => !o.completed && o.date >= todayStr);
  return upcoming[0] ? upcoming[0].date : null;
}

// Occurrences for any job (single or recurring) inside an inclusive date range.
// Each entry carries the job, so callers can map across many jobs at once.
function jobOccurrencesInRange(job, startDate, endDate) {
  if (job.type === 'single') {
    if (!job.date || job.date < startDate || job.date > endDate) return [];
    return [{
      job, date: job.date,
      completed: job.status === 'completed',
      rescheduledFrom: null,
    }];
  }
  if (job.type !== 'recurring' || !job.start_date) return [];

  const { set, rescheduledFrom } = applyDateAdjustments(
    job, generatePatternDates(job, parseDate(endDate))
  );
  const completed = new Set(job.completed_dates || []);

  return [...set]
    .filter((d) => d >= startDate && d <= endDate)
    .sort()
    .map((date) => ({
      job, date,
      completed: completed.has(date),
      rescheduledFrom: rescheduledFrom[date] || null,
    }));
}

// Node only. In the browser `module` is undefined and this is skipped, leaving
// the declarations above as globals for the app bundle.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseDate,
    formatYMD,
    addDays,
    addMonths,
    todayStart,
    generatePatternDates,
    applyDateAdjustments,
    computeOccurrences,
    nextDueDate,
    jobOccurrencesInRange,
  };
}
