const express = require('express');
const { query } = require('../config/db');
const { sendEmail } = require('../utils/email');

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9-]{1,60}$/;
const TIME_WINDOWS = new Set(['morning', 'afternoon', 'evening', 'anytime']);

router.get('/orgs/:slug', async (req, res, next) => {
  const slug = (req.params.slug || '').toLowerCase();
  if (!SLUG_RE.test(slug)) return res.status(404).json({ error: 'Not found' });
  try {
    const { rows } = await query(
      `SELECT o.id, o.name AS organization_name,
              s.company_name, s.logo_url,
              s.customer_label, s.customer_label_plural,
              s.job_label, s.job_label_plural
       FROM organizations o
       LEFT JOIN organization_settings s ON s.organization_id = o.id
       WHERE o.slug = $1 AND o.deleted_at IS NULL LIMIT 1`,
      [slug]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = rows[0];
    res.json({
      id: row.id,
      name: row.company_name || row.organization_name,
      logo_url: row.logo_url,
      customer_label: row.customer_label || 'Customer',
      customer_label_plural: row.customer_label_plural || 'Customers',
      job_label: row.job_label || 'Job',
      job_label_plural: row.job_label_plural || 'Jobs',
    });
  } catch (err) { next(err); }
});

router.get('/profile/:slug', async (req, res, next) => {
  const slug = (req.params.slug || '').toLowerCase();
  if (!SLUG_RE.test(slug)) return res.status(404).json({ error: 'Not found' });
  try {
    const { rows } = await query(
      `SELECT o.slug, o.name AS organization_name,
              s.company_name, s.logo_url, s.about,
              s.address, s.phone, s.email,
              s.customer_label, s.customer_label_plural,
              s.job_label, s.job_label_plural
       FROM organizations o
       LEFT JOIN organization_settings s ON s.organization_id = o.id
       WHERE o.slug = $1 AND o.deleted_at IS NULL LIMIT 1`,
      [slug]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = rows[0];
    res.json({
      slug: row.slug,
      name: row.company_name || row.organization_name,
      logo_url: row.logo_url,
      about: row.about,
      address: row.address,
      phone: row.phone,
      email: row.email,
      customer_label: row.customer_label || 'Customer',
      customer_label_plural: row.customer_label_plural || 'Customers',
      job_label: row.job_label || 'Job',
      job_label_plural: row.job_label_plural || 'Jobs',
    });
  } catch (err) { next(err); }
});

router.post('/book/:slug', async (req, res, next) => {
  const slug = (req.params.slug || '').toLowerCase();
  if (!SLUG_RE.test(slug)) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const requester_name = (b.requester_name || '').trim();
  const requester_email = (b.requester_email || '').trim().toLowerCase() || null;
  const requester_phone = (b.requester_phone || '').trim() || null;
  const requester_address = (b.requester_address || '').trim() || null;
  const service_description = (b.service_description || '').trim();
  const preferred_date = b.preferred_date || null;
  const preferred_time_window = TIME_WINDOWS.has(b.preferred_time_window) ? b.preferred_time_window : 'anytime';
  const notes = (b.notes || '').trim() || null;

  if (!requester_name) return res.status(400).json({ error: 'Name is required' });
  if (!requester_email && !requester_phone) {
    return res.status(400).json({ error: 'Please provide an email or a phone number so we can reach you' });
  }
  if (!service_description) return res.status(400).json({ error: 'Please describe what you need' });
  if (b.website) return res.json({ ok: true }); // honeypot

  try {
    const orgRow = await query(
      `SELECT o.id, o.name AS organization_name,
              s.company_name, s.email AS settings_email
       FROM organizations o
       LEFT JOIN organization_settings s ON s.organization_id = o.id
       WHERE o.slug = $1 AND o.deleted_at IS NULL LIMIT 1`,
      [slug]
    );
    if (orgRow.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const org = orgRow.rows[0];

    const inserted = await query(
      `INSERT INTO booking_requests
        (organization_id, requester_name, requester_email, requester_phone, requester_address,
         service_description, preferred_date, preferred_time_window, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, created_at`,
      [org.id, requester_name, requester_email, requester_phone, requester_address,
       service_description, preferred_date, preferred_time_window, notes]
    );

    let notifyTo = org.settings_email;
    if (!notifyTo) {
      const admin = await query(
        `SELECT email FROM users WHERE organization_id = $1 AND role = 'admin' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
        [org.id]
      );
      notifyTo = admin.rows[0] && admin.rows[0].email;
    }

    if (notifyTo) {
      const orgDisplayName = org.company_name || org.organization_name;
      const appUrl = process.env.APP_URL || 'https://fieldmgr.com';
      const detailsHtml = [
        `<p style="margin:0 0 6px;"><strong>${escapeHtml(requester_name)}</strong></p>`,
        requester_email ? `<p style="margin:0 0 6px;">Email: ${escapeHtml(requester_email)}</p>` : '',
        requester_phone ? `<p style="margin:0 0 6px;">Phone: ${escapeHtml(requester_phone)}</p>` : '',
        requester_address ? `<p style="margin:0 0 6px;">Address: ${escapeHtml(requester_address)}</p>` : '',
        `<p style="margin:12px 0 0;"><strong>What they need:</strong><br/>${escapeHtml(service_description).replace(/\n/g, '<br/>')}</p>`,
        preferred_date ? `<p style="margin:12px 0 0;">Preferred date: ${escapeHtml(preferred_date)} (${escapeHtml(preferred_time_window)})</p>` : '',
        notes ? `<p style="margin:12px 0 0;">Notes:<br/>${escapeHtml(notes).replace(/\n/g, '<br/>')}</p>` : '',
      ].filter(Boolean).join('');
      const html = `
        <!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif; padding:24px; max-width:600px;">
          <h2 style="margin:0 0 16px;">New booking request</h2>
          ${detailsHtml}
          <p style="margin:24px 0 0;"><a href="${appUrl}/requests" style="display:inline-block; background:#4a5e7a; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">Review in Field Manager</a></p>
        </body></html>
      `;
      const text = `New booking request for ${orgDisplayName}\n\n${requester_name}\n${requester_email || ''}\n${requester_phone || ''}\n\n${service_description}\n${preferred_date ? `\nPreferred: ${preferred_date} (${preferred_time_window})` : ''}\n\nReview: ${appUrl}/requests`;
      sendEmail({
        to: notifyTo,
        subject: `New booking request from ${requester_name}`,
        html, text,
      }).catch((err) => console.warn('booking email failed:', err.message));
    }

    res.status(201).json({ ok: true, id: inserted.rows[0].id });
  } catch (err) { next(err); }
});

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

router.get('/invoices/:id', async (req, res, next) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: 'Not found' });

  try {
    const { rows } = await query(
      `SELECT
         i.id, i.invoice_number, i.status, i.description,
         i.date, i.sent_date, i.paid_date, i.line_items,
         i.discount_type, i.discount_value, i.tax_rate,
         c.first_name AS customer_first_name,
         c.last_name AS customer_last_name,
         c.business_name AS customer_business_name,
         c.email AS customer_email,
         c.address AS customer_address,
         c.phone AS customer_phone,
         o.name AS organization_name,
         s.company_name, s.logo_url,
         s.address AS company_address,
         s.phone AS company_phone,
         s.email AS company_email,
         s.venmo_handle
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       JOIN organizations o ON o.id = i.organization_id
       LEFT JOIN organization_settings s ON s.organization_id = i.organization_id
       WHERE i.id = $1
         AND i.deleted_at IS NULL
         AND i.status IN ('sent', 'paid')
       LIMIT 1`,
      [id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
