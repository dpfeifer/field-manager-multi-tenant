#!/usr/bin/env node
// Mondays: one email to the founder — who signed up, who is using it, who went
// quiet. Selling is the job now, and this is its scoreboard. Guarded by
// system_settings.weekly_digest_sent_on so a Monday redeploy cannot repeat it.
require('dotenv').config();
const { query } = require('../src/config/db');
const { sendEmail } = require('../src/utils/email');

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ago = (d) => {
  if (!d) return 'never';
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

const ORG_SQL = `
  SELECT o.id, o.name, o.slug, o.trade, o.created_at, o.last_active_at, o.onboarding_completed_at, o.subscription_status,
         (SELECT COUNT(*)::int FROM customers WHERE organization_id = o.id AND deleted_at IS NULL) AS customers,
         (SELECT COUNT(*)::int FROM jobs WHERE organization_id = o.id AND deleted_at IS NULL) AS jobs,
         (SELECT COUNT(*)::int FROM jobs j, jsonb_array_elements_text(COALESCE(j.completed_dates, '[]'::jsonb)) d
           WHERE j.organization_id = o.id AND j.deleted_at IS NULL AND d::date > CURRENT_DATE - 7) AS completions_7d
  FROM organizations o
  WHERE o.deleted_at IS NULL AND o.is_demo = FALSE`;

async function buildDigest() {
  const { rows } = await query(`${ORG_SQL} ORDER BY o.created_at DESC`);
  const now = Date.now();
  const within = (d, days) => d && now - new Date(d).getTime() < days * 86400000;
  const fresh = rows.filter((o) => within(o.created_at, 7));
  const active = rows.filter((o) => within(o.last_active_at, 7));
  const working = rows.filter((o) => o.completions_7d > 0);
  // Used it before, not this week, and not so long ago that it is old news.
  const quiet = rows.filter((o) => o.last_active_at && !within(o.last_active_at, 7) && within(o.last_active_at, 28));
  return { total: rows.length, fresh, active, working, quiet };
}

function render(d) {
  const row = (o) => `<tr>
    <td style="padding:7px 10px 7px 0; border-bottom:1px solid #ece6d8;"><strong>${esc(o.name)}</strong><br/><span style="color:#6d6a64; font-size:12px;">${esc(o.trade || 'no trade picked')}${o.onboarding_completed_at ? '' : ' · onboarding not finished'}</span></td>
    <td style="padding:7px 10px; border-bottom:1px solid #ece6d8; font-size:13px; white-space:nowrap;">${o.customers} cust · ${o.jobs} jobs · ${o.completions_7d} done/7d</td>
    <td style="padding:7px 0 7px 10px; border-bottom:1px solid #ece6d8; font-size:13px; color:#6d6a64; white-space:nowrap;">active ${ago(o.last_active_at)}</td>
  </tr>`;
  const block = (title, list, empty) => `<h2 style="font-size:15px; margin:26px 0 8px;">${title} (${list.length})</h2>${
    list.length ? `<table style="width:100%; border-collapse:collapse; font-size:14px;">${list.map(row).join('')}</table>` : `<p style="margin:0; color:#6d6a64; font-size:14px;">${empty}</p>`}`;
  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; padding:24px; max-width:680px; color:#2d2a26; line-height:1.5;">
  <h1 style="font-size:20px; margin:0 0 6px;">Field Manager — the week</h1>
  <p style="margin:0; color:#6d6a64; font-size:14px;">${d.total} accounts · ${d.fresh.length} new · ${d.active.length} active · <strong style="color:#2d2a26;">${d.working.length} completed work this week</strong> · ${d.quiet.length} gone quiet</p>
  ${block('New this week', d.fresh, 'No signups this week.')}
  ${block('Completed work this week', d.working, 'Nobody marked a job complete this week.')}
  ${block('Gone quiet — used it, but not in the last 7 days', d.quiet, 'Nobody has dropped off.')}
  <p style="margin:26px 0 0; color:#6d6a64; font-size:12px;">“Completed work this week” is the number that matters: people who signed up and are still doing their job in it. Full list: ${(process.env.APP_URL || 'https://fieldmgr.com')}/staff</p>
</body></html>`;
  const line = (o) => `  ${o.name} (${o.trade || 'no trade'}) — ${o.customers} cust, ${o.jobs} jobs, ${o.completions_7d} done/7d, active ${ago(o.last_active_at)}`;
  const text = `Field Manager — the week\n${d.total} accounts · ${d.fresh.length} new · ${d.active.length} active · ${d.working.length} completed work · ${d.quiet.length} quiet\n\nNEW\n${d.fresh.map(line).join('\n') || '  none'}\n\nCOMPLETED WORK\n${d.working.map(line).join('\n') || '  none'}\n\nGONE QUIET\n${d.quiet.map(line).join('\n') || '  none'}\n`;
  return { subject: `Field Manager: ${d.fresh.length} new, ${d.working.length} working, ${d.quiet.length} quiet`, html, text };
}

async function main({ force = false } = {}) {
  const today = new Date();
  if (!force && today.getUTCDay() !== 1) return;                       // Mondays
  const day = today.toISOString().slice(0, 10);
  if (!force) {
    const claim = await query(
      `UPDATE system_settings SET weekly_digest_sent_on = $1 WHERE id = 1 AND (weekly_digest_sent_on IS NULL OR weekly_digest_sent_on < $1) RETURNING id`, [day]
    );
    if (claim.rowCount === 0) return;                                   // already sent today
  }
  const tpl = render(await buildDigest());
  const r = await sendEmail({ to: process.env.SUPPORT_EMAIL || 'dustin@drxlr.com', subject: tpl.subject, html: tpl.html, text: tpl.text });
  console.log(`weekly digest: ${r.sent ? 'sent' : r.reason}`);
}

module.exports = { main, buildDigest, render };
if (require.main === module) main({ force: process.argv.includes('--force') }).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
