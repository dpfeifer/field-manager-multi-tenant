// Daily cron: for each org with an auto-invoice schedule that fires today,
// roll up unbilled completions into draft invoices and email a summary.
//
// Wire on Railway as a scheduled job that runs once per day.
const { query } = require('../src/config/db');
const { runAutoInvoiceForOrg, shouldRunToday } = require('../src/utils/autoInvoice');
const { sendEmail } = require('../src/utils/email');

async function main() {
  const today = new Date();
  const { rows: orgs } = await query(
    `SELECT o.id, o.slug, o.name AS org_name,
            s.auto_invoice_schedule, s.auto_invoice_day_of_month,
            s.auto_invoice_day_of_week, s.email AS settings_email,
            s.company_name
     FROM organizations o
     JOIN organization_settings s ON s.organization_id = o.id
     WHERE o.deleted_at IS NULL
       AND s.auto_invoice_schedule <> 'off'`
  );

  let totalDrafted = 0;
  for (const org of orgs) {
    const settings = {
      auto_invoice_schedule: org.auto_invoice_schedule,
      auto_invoice_day_of_month: org.auto_invoice_day_of_month,
      auto_invoice_day_of_week: org.auto_invoice_day_of_week,
    };
    if (!shouldRunToday(settings, today)) continue;

    try {
      const result = await runAutoInvoiceForOrg(org.id, {
        schedule: org.auto_invoice_schedule,
        today,
      });
      totalDrafted += result.drafted.length;
      if (result.drafted.length > 0) {
        await notifyOrgSummary(org, result);
      }
      console.log(`auto-invoice ${org.slug}: drafted ${result.drafted.length}`);
    } catch (err) {
      console.error(`auto-invoice ${org.slug} failed:`, err);
    }
  }

  console.log(`auto-invoice cron done. ${orgs.length} orgs evaluated, ${totalDrafted} invoices drafted.`);
}

async function notifyOrgSummary(org, result) {
  const to = org.settings_email;
  if (!to) {
    const admin = await query(
      `SELECT email FROM users WHERE organization_id = $1 AND role = 'admin' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
      [org.id]
    );
    if (!admin.rows[0]) return;
  }
  const recipient = to || (await firstAdminEmail(org.id));
  if (!recipient) return;

  const total = result.drafted.reduce((s, d) => s + (d.total || 0), 0);
  const totalFmt = '$' + total.toFixed(2);
  const periodStr = `${result.period.start} – ${result.period.end}`;
  const appUrl = process.env.APP_URL || 'https://fieldmgr.com';
  const orgDisplay = org.company_name || org.org_name;
  const subject = `${result.drafted.length} draft ${result.drafted.length === 1 ? 'invoice' : 'invoices'} ready · ${orgDisplay}`;
  const html = `
    <!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif; padding:24px; max-width:600px;">
      <h2 style="margin:0 0 12px;">Auto-invoice run complete</h2>
      <p style="color:#666; margin:0 0 16px;">${result.drafted.length} draft ${result.drafted.length === 1 ? 'invoice' : 'invoices'} for ${periodStr}, totaling ${totalFmt}.</p>
      <p style="margin:0 0 18px;">Drafts are sitting in your Invoices tab. Review, tweak if needed, then send each to your ${orgDisplay} customers.</p>
      <p><a href="${appUrl}/invoices" style="display:inline-block; background:#4a5e7a; color:#fff; padding:10px 18px; border-radius:8px; text-decoration:none; font-weight:600;">Review invoices</a></p>
    </body></html>
  `;
  const text = `Auto-invoice run complete: ${result.drafted.length} drafts totaling ${totalFmt} for ${periodStr}. Review at ${appUrl}/invoices`;
  await sendEmail({ to: recipient, subject, html, text });
}

async function firstAdminEmail(orgId) {
  const { rows } = await query(
    `SELECT email FROM users WHERE organization_id = $1 AND role = 'admin' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
    [orgId]
  );
  return rows[0] && rows[0].email;
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
