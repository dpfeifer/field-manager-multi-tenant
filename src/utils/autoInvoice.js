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

// Returns a summary: { drafted: [{ customer_id, invoice_id, total, count }], skipped_customers }
async function runAutoInvoiceForOrg(orgId, opts = {}) {
  const schedule = opts.schedule || 'monthly';
  const period = computePeriod(schedule, opts.today);
  if (!period) throw new Error('Invalid schedule');

  // Pull all recurring jobs with their customer (not excluded). Only customers
  // not opted out, only jobs not soft-deleted.
  const { rows: jobs } = await query(
    `SELECT j.id, j.customer_id, j.title, j.default_price,
            j.completed_dates, j.billed_dates,
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
    const newlyBillable = completed.filter((d) => d >= period.start && d <= period.end && !billed.has(d));
    if (newlyBillable.length === 0) continue;
    if (!byCustomer.has(job.customer_id)) byCustomer.set(job.customer_id, []);
    byCustomer.get(job.customer_id).push({ job, dates: newlyBillable });
  }

  if (byCustomer.size === 0) {
    return { drafted: [], period };
  }

  const drafted = [];
  for (const [customerId, entries] of byCustomer.entries()) {
    // Build the consolidated line items per (job, date).
    const lineItems = [];
    let total = 0;
    let dateCount = 0;
    for (const { job, dates } of entries) {
      const rate = job.default_price != null ? parseFloat(job.default_price) : 0;
      for (const date of dates) {
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
      const description = schedule === 'monthly'
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

  return { drafted, period };
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
  runAutoInvoiceForOrg,
  shouldRunToday,
};
