// Referral credits. When a job is completed for a customer somebody referred,
// the referrer earns a percentage of that visit's price as credit on their
// own account. The reward is a row in the ordinary credit ledger, tagged with
// the job and visit date it came from so an undo can find it again.
const { round2 } = require('./credits');

function displayName(c) {
  return c.business_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || 'a customer';
}

// Called inside the completion's transaction. Quietly does nothing when the
// section is off, nobody referred this customer, the visit has no price, the
// cap is reached, or this visit has already paid out.
async function awardReferralCredit(client, { orgId, job, date, userId }) {
  // The Referrals section (Settings → Sections) is the on/off switch; the
  // settings row only holds the terms, and may not exist yet — hence the
  // defaults, which match the column defaults.
  const { rows: s } = await client.query(
    `SELECT (o.features->>'referrals') = 'true' AS enabled,
            COALESCE(st.referral_percent, 10) AS referral_percent,
            CASE WHEN st.organization_id IS NULL THEN 5 ELSE st.referral_cap_jobs END AS referral_cap_jobs
     FROM organizations o
     LEFT JOIN organization_settings st ON st.organization_id = o.id
     WHERE o.id = $1 LIMIT 1`,
    [orgId]
  );
  if (!s[0] || !s[0].enabled) return null;
  const percent = parseFloat(s[0].referral_percent) || 0;
  const price = parseFloat(job.default_price) || 0;
  const amount = round2(price * percent / 100);
  if (amount <= 0 || !job.customer_id) return null;

  const { rows: c } = await client.query(
    `SELECT c.first_name, c.last_name, c.business_name, r.id AS referrer_id
     FROM customers c
     JOIN customers r ON r.id = c.referred_by_customer_id
                     AND r.organization_id = c.organization_id AND r.deleted_at IS NULL
     WHERE c.id = $1 AND c.organization_id = $2 LIMIT 1`,
    [job.customer_id, orgId]
  );
  if (c.length === 0) return null;

  const cap = s[0].referral_cap_jobs;
  if (cap != null) {
    const { rows: n } = await client.query(
      `SELECT COUNT(*)::int AS n FROM customer_credits
       WHERE organization_id = $1 AND source_customer_id = $2 AND deleted_at IS NULL`,
      [orgId, job.customer_id]
    );
    if (n[0].n >= cap) return null;
  }

  const note = `Referral reward — ${job.title || 'job'} for ${displayName(c[0])}, ${date} (${percent}% of $${price.toFixed(2)})`;
  const { rows } = await client.query(
    `INSERT INTO customer_credits
       (organization_id, customer_id, amount, note, created_by, source_job_id, source_date, source_customer_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (source_job_id, source_date)
       WHERE deleted_at IS NULL AND source_job_id IS NOT NULL
     DO NOTHING
     RETURNING id, amount`,
    [orgId, c[0].referrer_id, amount, note.slice(0, 500), userId || null, job.id, date, job.customer_id]
  );
  return rows[0] || null;
}

// The visit was undone — take the reward back. If the referrer has already
// spent it, their balance goes negative by that much and the next reward or
// prepayment fills it in; the ledger stays honest either way.
async function reverseReferralCredit(client, { orgId, jobId, date }) {
  await client.query(
    `UPDATE customer_credits SET deleted_at = NOW()
     WHERE organization_id = $1 AND source_job_id = $2 AND source_date = $3 AND deleted_at IS NULL`,
    [orgId, jobId, date]
  );
}

module.exports = { awardReferralCredit, reverseReferralCredit };
