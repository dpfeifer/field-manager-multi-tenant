#!/usr/bin/env node
// Daily: the day-2 and day-7 emails for new accounts. See src/utils/lifecycle.js.
// Idempotent — each milestone has a sent_at column — and windowed, so a day the
// job did not run is made up the next day rather than skipped.
require('dotenv').config();
const { query } = require('../src/config/db');
const { sendEmail } = require('../src/utils/email');
const { renderLifecycleEmail } = require('../src/utils/lifecycle');

const MILESTONES = [
  { key: 'd2', col: 'lifecycle_d2_sent_at', from: 2, to: 6 },
  { key: 'd7', col: 'lifecycle_d7_sent_at', from: 7, to: 13 },
];

async function main() {
  let sent = 0;
  for (const m of MILESTONES) {
    const { rows } = await query(
      `SELECT o.id, o.name, o.last_active_at,
              s.customer_label, s.customer_label_plural, s.job_label,
              (SELECT u.email FROM users u WHERE u.organization_id = o.id AND u.role = 'admin' AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 1) AS email,
              (SELECT u.name  FROM users u WHERE u.organization_id = o.id AND u.role = 'admin' AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 1) AS user_name,
              (SELECT COUNT(*)::int FROM customers WHERE organization_id = o.id AND deleted_at IS NULL) AS customers,
              (SELECT COUNT(*)::int FROM jobs WHERE organization_id = o.id AND deleted_at IS NULL) AS jobs,
              (SELECT COUNT(*)::int FROM invoices WHERE organization_id = o.id AND deleted_at IS NULL) AS invoices,
              (SELECT COALESCE(SUM(jsonb_array_length(COALESCE(j.completed_dates, '[]'::jsonb))), 0)::int
                 FROM jobs j WHERE j.organization_id = o.id AND j.deleted_at IS NULL) AS completions
       FROM organizations o
       LEFT JOIN organization_settings s ON s.organization_id = o.id
       WHERE o.deleted_at IS NULL AND o.is_demo = FALSE AND o.lifecycle_opt_out = FALSE
         AND o.${m.col} IS NULL
         AND o.created_at <= NOW() - ($1 || ' days')::interval
         AND o.created_at >  NOW() - ($2 || ' days')::interval`,
      [String(m.from), String(m.to + 1)]
    );
    for (const o of rows) {
      // Claim it first: if the send fails we would rather miss one email than
      // risk sending the same one every day.
      const claim = await query(
        `UPDATE organizations SET ${m.col} = NOW() WHERE id = $1 AND ${m.col} IS NULL RETURNING id`, [o.id]
      );
      if (claim.rowCount === 0 || !o.email) continue;
      const activeRecently = !!o.last_active_at && (Date.now() - new Date(o.last_active_at).getTime()) < 4 * 86400000;
      const tpl = renderLifecycleEmail({
        milestone: m.key, orgId: o.id,
        firstName: (o.user_name || '').split(' ')[0] || '',
        stats: { customers: o.customers, jobs: o.jobs, invoices: o.invoices, completions: o.completions, active_recently: activeRecently },
        words: {
          customer: (o.customer_label || 'customer').toLowerCase(),
          customers: (o.customer_label_plural || 'customers').toLowerCase(),
          job: (o.job_label || 'job').toLowerCase(),
        },
      });
      const r = await sendEmail({ to: o.email, subject: tpl.subject, html: tpl.html, text: tpl.text, replyTo: process.env.SUPPORT_EMAIL || 'dustin@drxlr.com' });
      if (r.sent) sent++;
      console.log(`lifecycle ${m.key} -> ${o.name}: ${r.sent ? 'sent' : r.reason}`);
    }
  }
  console.log(`lifecycle emails done. ${sent} sent.`);
}

module.exports = { main };
if (require.main === module) main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
