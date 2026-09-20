const { query, withTransaction } = require('../config/db');

// Compute the billing period for an org's schedule, ending today.
//   monthly: previous full calendar month (e.g., if today is June 1, period is May 1..May 31)
//   weekly:  previous 7 days (today minus 7 .. yesterday)
function computePeriod(schedule, todayDate = new Date()) {
  const today = new Date(todayDate);
  today.setHours(0, 0, 0, 0);
  if (schedule === 'monthly') {
    const end = new Date(today.getFullYear(), today.getMonth(), 0); // last day of prev month
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return { start: ymd(start), end: ymd(end) };
  }
  if (schedule === 'weekly') {
    const end = new Date(today);
    end.setDate(end.getDate() - 1);
    const start = new Date(today);
    start.setDate(start.getDate() - 7);
    return { start: ymd(start), end: ymd(end) };
  }
  return null;
}

function ymd(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// How far back a run may reach to pick up visits an earlier run never saw —
// the schedule was off for a while, or the run did not happen. Bounded on
// purpose: while the schedule was off the owner was probably invoicing by
// hand, and hand-made invoices do not mark visits as billed, so an unbounded
// catch-up would draft their whole history again. And never before the first
// run at all: an account with years of imported visits must not wake up to
// all of them on one invoice.
const CATCH_UP_DAYS = { monthly: 92, weekly: 28 };

function addDays(ymdStr, n) {
  const d = new Date(`${ymdStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

// Where this run starts looking. Normally the period's own start; earlier when
// the last run left a gap.
function catchUpStart(schedule, period, settings) {
  // A DATE column arrives as 'YYYY-MM-DD' text from this driver. Parsing that
  // with new Date() reads it as UTC midnight, which is the evening before in
  // any American time zone — a whole day early. Take the text as it is.
  const raw = settings && settings.auto_invoice_billed_through;
  let through = !raw ? null : (typeof raw === 'string' ? raw.slice(0, 10) : ymd(raw));
  // Runs from before billed_through existed: infer it from the last run.
  if (!through && settings && settings.auto_invoice_last_run_at) {
    const prev = computePeriod(schedule, new Date(settings.auto_invoice_last_run_at));
    through = prev ? prev.end : null;
  }
  if (!through) return period.start;                 // first run ever: no catch-up
  const next = addDays(through, 1);
  if (next >= period.start) return period.start;     // no gap
  const floor = addDays(period.start, -CATCH_UP_DAYS[schedule]);
  return next > floor ? next : floor;
}

// Returns a summary: { drafted: [{ customer_id, invoice_id, total, count }], period, caught_up_from }
async function runAutoInvoiceForOrg(orgId, opts = {}) {
  const schedule = opts.schedule || 'monthly';
  const period = computePeriod(schedule, opts.today);
  if (!period) throw new Error('Invalid schedule');

  const { rows: sRows } = await query(
    `SELECT auto_invoice_billed_through, auto_invoice_last_run_at
     FROM organization_settings WHERE organization_id = $1 LIMIT 1`,
    [orgId]
  );
  const from = catchUpStart(schedule, period, sRows[0]);
  const caughtUp = from < period.start;

  // Pull all recurring jobs with their customer (not excluded). Only customers
  // not opted out, only jobs not soft-deleted.
  const { rows: jobs } = await query(
    `SELECT j.id, j.customer_id, j.title, j.default_price,
            j.completed_dates, j.billed_dates, j.completion_notes,
            c.first_name, c.last_name, c.business_name, c.auto_invoice_excluded
     FROM jobs j
     JOIN customers c ON c.id = j.customer_id
     WHERE j.organization_id = $1
       AND j.deleted_at IS NULL
       AND c.deleted_at IS NULL
       AND c.auto_invoice_excluded = FALSE`,
    [orgId]
  );

  // Group unbilled completions in-period by customer.
  const byCustomer = new Map();
  for (const job of jobs) {
    const completed = Array.isArray(job.completed_dates) ? job.completed_dates : [];
    const billed = new Set(Array.isArray(job.billed_dates) ? job.billed_dates : []);
    const newlyBillable = completed.filter((d) => d >= from && d <= period.end && !billed.has(d)).sort();
    if (newlyBillable.length === 0) continue;
    if (!byCustomer.has(job.customer_id)) byCustomer.set(job.customer_id, []);
    byCustomer.get(job.customer_id).push({ job, dates: newlyBillable });
  }

  // Recorded whether or not anything was found, so the next run can tell a
  // quiet month from a missed one.
  const markThrough = () => query(
    `UPDATE organization_settings SET auto_invoice_billed_through = $2, updated_at = NOW()
     WHERE organization_id = $1`,
    [orgId, period.end]
  );

  if (byCustomer.size === 0) {
    await markThrough();
    return { drafted: [], period, caught_up_from: null };
  }

  const drafted = [];
  for (const [customerId, entries] of byCustomer.entries()) {
    // Build the consolidated line items per (job, date).
    const lineItems = [];
    let total = 0;
    let dateCount = 0;
    for (const { job, dates } of entries) {
      const current = job.default_price != null ? parseFloat(job.default_price) : 0;
      // What the visit cost on the day, when the completion recorded it. A
      // price change mid-month applies from that day on, not backwards.
      // Visits from before prices were recorded fall back to today's.
      const priceOn = new Map();
      for (const n of (Array.isArray(job.completion_notes) ? job.completion_notes : [])) {
        if (n && n.date && n.price != null && Number.isFinite(parseFloat(n.price))) priceOn.set(n.date, parseFloat(n.price));
      }
      for (const date of dates) {
        const rate = priceOn.has(date) ? priceOn.get(date) : current;
        lineItems.push({
          description: `${job.title} — ${date}`,
          quantity: 1,
          rate,
          amount: rate,
        });
        total += rate;
        dateCount++;
      }
    }

    // One transaction per customer so a partial failure doesn't strand bills.
    // eslint-disable-next-line no-await-in-loop
    const invoiceId = await withTransaction(async (client) => {
      const bumped = await client.query(
        `UPDATE organizations
         SET next_invoice_number = next_invoice_number + 1
         WHERE id = $1
         RETURNING next_invoice_number - 1 AS invoice_number`,
        [orgId]
      );
      const invoiceNumber = bumped.rows[0].invoice_number;
      // Say so when it reaches back, and only on the invoices that actually do.
      const reachesBack = caughtUp && entries.some(({ dates }) => dates.some((d) => d < period.start));
      const description = reachesBack
        ? `Auto-billed for ${from} – ${period.end}, including earlier visits that were never invoiced`
        : schedule === 'monthly'
          ? `Auto-billed for ${period.start} – ${period.end}`
          : `Auto-billed for week of ${period.start}`;
      const inserted = await client.query(
        `INSERT INTO invoices
          (organization_id, customer_id, invoice_number, status, description, date, line_items)
         VALUES ($1, $2, $3, 'draft', $4, CURRENT_DATE, $5::jsonb)
         RETURNING id`,
        [orgId, customerId, invoiceNumber, description, JSON.stringify(lineItems)]
      );
      const newInvoiceId = inserted.rows[0].id;

      // Mark each (job, date) as billed by appending to billed_dates on each job.
      for (const { job, dates } of entries) {
        const updated = Array.from(new Set([
          ...(Array.isArray(job.billed_dates) ? job.billed_dates : []),
          ...dates,
        ])).sort();
        // eslint-disable-next-line no-await-in-loop
        await client.query(
          `UPDATE jobs SET billed_dates = $2::jsonb, updated_at = NOW() WHERE id = $1`,
          [job.id, JSON.stringify(updated)]
        );
      }
      return newInvoiceId;
    });

    drafted.push({ customer_id: customerId, invoice_id: invoiceId, total, count: dateCount });
  }

  await query(
    `UPDATE organization_settings SET auto_invoice_last_run_at = NOW(), updated_at = NOW()
     WHERE organization_id = $1`,
    [orgId]
  );

  await markThrough();
  return { drafted, period, caught_up_from: caughtUp ? from : null };
}

// Decide whether today is the scheduled day for this org's settings.
function shouldRunToday(settings, today = new Date()) {
  const schedule = settings.auto_invoice_schedule;
  if (!schedule || schedule === 'off') return false;
  if (schedule === 'monthly') {
    const dayOfMonth = settings.auto_invoice_day_of_month || 1;
    return today.getDate() === dayOfMonth;
  }
  if (schedule === 'weekly') {
    const dayOfWeek = settings.auto_invoice_day_of_week != null ? settings.auto_invoice_day_of_week : 1;
    return today.getDay() === dayOfWeek;
  }
  return false;
}

module.exports = {
  computePeriod,
  catchUpStart,
  runAutoInvoiceForOrg,
  shouldRunToday,
};
