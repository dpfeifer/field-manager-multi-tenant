#!/usr/bin/env node
//
// Daily trial reminder cron.
//
// Sends one of three emails to each admin of orgs in 'trialing' status:
//   - 3-day reminder when trial_ends_at is 2-3 days out and not yet sent
//   - 1-day reminder when trial_ends_at is 0-1 days out and not yet sent
//   - expired notice when trial_ends_at has passed and not yet sent
//
// Each reminder is tracked via a *_sent_at column on organizations so we
// never email an admin twice for the same milestone.
//
// Run via Railway Cron service: `node scripts/send-trial-reminders.js`
// Suggested schedule: daily at 09:00 UTC.

require('dotenv').config();
const { pool } = require('../src/config/db');
const { sendEmail } = require('../src/utils/email');
const { getTemplate } = require('../src/utils/templateStore');
const { renderEditableTemplate } = require('../src/utils/emailTemplates');

const APP_URL = process.env.APP_URL || 'https://fieldmgr.com';

async function fetchOrgsForMilestone(client, milestone) {
  // milestone: '3d' | '1d' | 'expired'
  if (milestone === '3d') {
    return (await client.query(`
      SELECT id, slug, name, trial_ends_at
      FROM organizations
      WHERE deleted_at IS NULL
        AND subscription_status = 'trialing'
        AND trial_ends_at IS NOT NULL
        AND trial_ends_at > NOW()
        AND trial_ends_at <= NOW() + INTERVAL '3 days'
        AND trial_ends_at > NOW() + INTERVAL '1 day'
        AND trial_reminder_3d_sent_at IS NULL
    `)).rows;
  }
  if (milestone === '1d') {
    return (await client.query(`
      SELECT id, slug, name, trial_ends_at
      FROM organizations
      WHERE deleted_at IS NULL
        AND subscription_status = 'trialing'
        AND trial_ends_at IS NOT NULL
        AND trial_ends_at > NOW()
        AND trial_ends_at <= NOW() + INTERVAL '1 day'
        AND trial_reminder_1d_sent_at IS NULL
    `)).rows;
  }
  if (milestone === 'expired') {
    return (await client.query(`
      SELECT id, slug, name, trial_ends_at
      FROM organizations
      WHERE deleted_at IS NULL
        AND subscription_status = 'trialing'
        AND trial_ends_at IS NOT NULL
        AND trial_ends_at <= NOW()
        AND trial_expired_email_sent_at IS NULL
    `)).rows;
  }
  return [];
}

async function admins(client, orgId) {
  return (await client.query(
    `SELECT id, email, name FROM users
     WHERE organization_id = $1 AND role = 'admin' AND deleted_at IS NULL`,
    [orgId]
  )).rows;
}

async function processMilestone(client, milestone, templateKey, sentColumn) {
  const orgs = await fetchOrgsForMilestone(client, milestone);
  const tpl = await getTemplate(templateKey);
  let totalSent = 0;
  for (const org of orgs) {
    const recipients = await admins(client, org.id);
    if (recipients.length === 0) {
      console.warn(`Org ${org.slug} has no admins to email`);
    }
    for (const admin of recipients) {
      const trialEndsOn = new Date(org.trial_ends_at).toLocaleDateString(undefined, {
        weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
      });
      const rendered = renderEditableTemplate(tpl, {
        user_name: admin.name || admin.email,
        organization_name: org.name,
        trial_ends_on: trialEndsOn,
        billing_url: `${APP_URL}/billing`,
      }, {
        ctaLabel: milestone === 'expired' ? 'Subscribe now' : 'Manage subscription',
        ctaUrl: `${APP_URL}/billing`,
        heading: rendered_heading_for(milestone),
      });
      const result = await sendEmail({
        to: admin.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      if (result.sent) totalSent++;
      else console.error(`Skipped ${admin.email} for ${org.slug}:`, result.reason, result.error);
    }
    await client.query(
      `UPDATE organizations SET ${sentColumn} = NOW(), updated_at = NOW() WHERE id = $1`,
      [org.id]
    );
  }
  console.log(`[${milestone}] ${orgs.length} orgs processed, ${totalSent} emails sent`);
}

function rendered_heading_for(milestone) {
  if (milestone === '3d') return 'Your trial ends in 3 days';
  if (milestone === '1d') return 'Your trial ends tomorrow';
  return 'Your trial has ended';
}

async function main() {
  const client = await pool.connect();
  try {
    await processMilestone(client, '3d', 'trial_reminder_3d', 'trial_reminder_3d_sent_at');
    await processMilestone(client, '1d', 'trial_reminder_1d', 'trial_reminder_1d_sent_at');
    await processMilestone(client, 'expired', 'trial_expired', 'trial_expired_email_sent_at');
  } finally {
    client.release();
  }
}

module.exports = { main };

if (require.main === module) {
  main().then(async () => {
    console.log('Trial reminders run complete.');
    await pool.end();
    process.exit(0);
  }).catch(async (err) => {
    console.error('Trial reminders failed:', err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
}
