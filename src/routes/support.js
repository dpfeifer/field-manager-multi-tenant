const express = require('express');
const { query } = require('../config/db');
const { sendEmail } = require('../utils/email');

const router = express.Router();

const CATEGORIES = ['Bug', 'Feature request', 'Billing', 'Question', 'Other'];

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

router.post('/', async (req, res, next) => {
  const body = req.body || {};
  const subject = String(body.subject || '').trim().slice(0, 200);
  const message = String(body.message || '').trim().slice(0, 5000);
  const context = String(body.context || '').trim().slice(0, 500);
  const category = CATEGORIES.includes(body.category) ? body.category : 'Other';

  if (!subject) return res.status(400).json({ error: 'Subject is required' });
  if (!message) return res.status(400).json({ error: 'Message is required' });

  try {
    const { rows } = await query(
      `SELECT u.email, u.name, u.role,
              o.name AS org_name, o.slug AS org_slug, o.subscription_status
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       WHERE u.id = $1 LIMIT 1`,
      [req.user.sub]
    );
    const u = rows[0] || {};
    const to = process.env.SUPPORT_EMAIL || 'dustin@drxlr.com';
    const senderDisplay = u.name ? `${u.name} <${u.email}>` : (u.email || 'unknown user');

    const html = `
<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; padding:24px; max-width:640px; color:#2d2a26;">
  <div style="display:inline-block; background:#c98558; color:#fff; padding:4px 12px; border-radius:999px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em;">${escapeHtml(category)}</div>
  <h2 style="margin:14px 0 8px; font-size:20px;">${escapeHtml(subject)}</h2>
  <div style="background:#f7f4ec; border:1px solid #ece6d8; border-radius:10px; padding:16px; margin:14px 0 18px; font-size:13px; line-height:1.7;">
    <div><strong>From:</strong> ${escapeHtml(senderDisplay)} <span style="color:#6d6a64;">(${escapeHtml(u.role || '?')})</span></div>
    <div><strong>Org:</strong> ${escapeHtml(u.org_name || '?')} <span style="color:#6d6a64;">(${escapeHtml(u.org_slug || '?')})</span></div>
    <div><strong>Plan:</strong> ${escapeHtml(u.subscription_status || '?')}</div>
    ${context ? `<div><strong>From page:</strong> ${escapeHtml(context)}</div>` : ''}
  </div>
  <div style="white-space:pre-wrap; font-size:14px; line-height:1.6;">${escapeHtml(message)}</div>
  <hr style="border:0; border-top:1px solid #ece6d8; margin:24px 0;" />
  <p style="font-size:12px; color:#6d6a64;">Reply directly to this email to respond to ${escapeHtml(u.email || 'the user')}.</p>
</body></html>`;
    const text = `[FM Support] [${category}] ${subject}

From: ${senderDisplay} (${u.role || '?'})
Org:  ${u.org_name || '?'} (${u.org_slug || '?'})
Plan: ${u.subscription_status || '?'}
${context ? `Page: ${context}\n` : ''}
${message}
`;

    const result = await sendEmail({
      to,
      replyTo: u.email,
      subject: `[FM Support] [${category}] ${subject}`,
      html,
      text,
    });

    if (!result.sent) {
      console.error('support: sendEmail failed', result);
      return res.status(500).json({ error: 'Could not send your request. Please try again in a moment.' });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
