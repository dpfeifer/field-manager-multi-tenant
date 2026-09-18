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
     RETURNING id, amount, customer_id`,
    [orgId, c[0].referrer_id, amount, note.slice(0, 500), userId || null, job.id, date, job.customer_id]
  );
  if (!rows[0]) return null;
  return { ...rows[0], referred_first_name: c[0].first_name || c[0].business_name || null };
}

// After the completion has committed: tell the referrer what they earned.
// Never awaited by the request and never allowed to fail it — the credit is
// already theirs whether or not the email goes out.
async function notifyReferralCredit(orgId, award) {
  try {
    if (!award) return;
    const { query } = require('../config/db');
    const { sendEmail } = require('./email');
    const { referralCreditTemplate } = require('./emailTemplates');
    const { rows } = await query(
      `SELECT r.email, r.first_name, r.business_name,
              o.name AS organization_name,
              s.company_name, s.email AS company_email, s.phone AS company_phone,
              COALESCE(s.referral_email_enabled, TRUE) AS email_enabled,
              (SELECT COALESCE(SUM(amount), 0) FROM customer_credits
               WHERE customer_id = r.id AND deleted_at IS NULL) AS balance
       FROM customers r
       JOIN organizations o ON o.id = r.organization_id
       LEFT JOIN organization_settings s ON s.organization_id = o.id
       WHERE r.id = $1 AND r.organization_id = $2 AND r.deleted_at IS NULL LIMIT 1`,
      [award.customer_id, orgId]
    );
    const r = rows[0];
    if (!r || !r.email || !r.email_enabled) return;
    const tpl = referralCreditTemplate({
      companyName: r.company_name || r.organization_name,
      companyEmail: r.company_email, companyPhone: r.company_phone,
      recipientName: r.first_name || r.business_name,
      referredName: award.referred_first_name,
      amount: award.amount, balance: r.balance,
    });
    await sendEmail({ to: r.email, subject: tpl.subject, html: tpl.html, text: tpl.text, replyTo: r.company_email || undefined });
  } catch (err) {
    console.error('referral credit email failed', err);
  }
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

// A customer's referral code, made the first time anyone asks for it. Eight
// characters from an alphabet with no 0/O/1/I/L, so it survives being read
// out over the phone or copied off a flyer.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() {
  const bytes = require('crypto').randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}
async function ensureReferralCode(db, orgId, customerId) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { rows } = await db.query(
      `UPDATE customers SET referral_code = COALESCE(referral_code, $3)
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       RETURNING referral_code`,
      [customerId, orgId, newCode()]
    ).catch((err) => {
      if (err.code === '23505') return { rows: null }; // code taken — draw again
      throw err;
    });
    if (rows === null) continue;
    return rows[0] ? rows[0].referral_code : null;
  }
  return null;
}

// Who a referral link belongs to. Only a code counts: what a visitor types
// into "Referred by" is shown to the owner, who picks the customer themselves
// when promoting the prospect — a name is not an identity, and this decides
// who gets paid. Always null while the Referrals section is off.
async function resolveReferrer(db, orgId, { code }) {
  const { rows: on } = await db.query(
    `SELECT 1 FROM organizations WHERE id = $1 AND (features->>'referrals') = 'true'`,
    [orgId]
  );
  if (on.length === 0) return null;
  const cols = 'id, first_name, last_name, business_name';
  if (code && /^[A-Za-z0-9]{4,16}$/.test(code)) {
    const { rows } = await db.query(
      `SELECT ${cols} FROM customers
       WHERE organization_id = $1 AND referral_code = $2 AND deleted_at IS NULL LIMIT 1`,
      [orgId, code.toUpperCase()]
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

module.exports = { awardReferralCredit, reverseReferralCredit, notifyReferralCredit, ensureReferralCode, resolveReferrer, displayName };
