const express = require('express');
const { query, withTransaction } = require('../config/db');
const { sendEmail } = require('../utils/email');

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9-]{1,60}$/;
const TIME_WINDOWS = new Set(['morning', 'afternoon', 'evening', 'anytime']);

const { getSystemSettings } = require('../utils/systemSettings');

router.get('/founder-status', async (req, res, next) => {
  try {
    const settings = await getSystemSettings();
    const { rows } = await query(
      `SELECT COUNT(*)::int AS used FROM organizations WHERE founder_pricing_applied_at IS NOT NULL`
    );
    const used = rows[0]?.used || 0;
    const remaining = Math.max(0, settings.founder_total_seats - used);
    res.json({
      total_seats: settings.founder_total_seats,
      seats_remaining: remaining,
      founder_price: settings.founder_price,
      listed_price: settings.listed_price,
      active: remaining > 0 && !!settings.stripe_founder_coupon_id,
    });
  } catch (err) { next(err); }
});

// Public contact form (no auth). Used by the /contact page that the Terms
// and Privacy pages link to instead of showing an email address. Emails
// the team and sets reply-to so we can respond to the sender directly.
router.post('/contact', async (req, res, next) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 200);
  const email = String(b.email || '').trim().slice(0, 200);
  const message = String(b.message || '').trim().slice(0, 5000);

  if (b.website) return res.json({ ok: true }); // honeypot
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (!message) return res.status(400).json({ error: 'Message is required' });

  try {
    const to = process.env.SUPPORT_EMAIL || 'dustin@drxlr.com';
    const html = `
<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; padding:24px; max-width:640px; color:#2d2a26;">
  <h2 style="margin:0 0 12px; font-size:20px;">New contact form message</h2>
  <div style="background:#f7f4ec; border:1px solid #ece6d8; border-radius:10px; padding:16px; margin:0 0 18px; font-size:13px; line-height:1.7;">
    <div><strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</div>
  </div>
  <div style="white-space:pre-wrap; font-size:14px; line-height:1.6;">${escapeHtml(message)}</div>
  <hr style="border:0; border-top:1px solid #ece6d8; margin:24px 0;" />
  <p style="font-size:12px; color:#6d6a64;">Reply directly to this email to respond to ${escapeHtml(email)}.</p>
</body></html>`;
    const text = `New contact form message\n\nFrom: ${name} <${email}>\n\n${message}\n`;
    const result = await sendEmail({
      to,
      replyTo: email,
      subject: `[FM Contact] Message from ${name}`,
      html,
      text,
    });
    if (!result.sent) {
      console.error('contact: sendEmail failed', result);
      return res.status(500).json({ error: 'Could not send your message. Please try again in a moment.' });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/orgs/:slug', async (req, res, next) => {
  const slug = (req.params.slug || '').toLowerCase();
  if (!SLUG_RE.test(slug)) return res.status(404).json({ error: 'Not found' });
  try {
    const { rows } = await query(
      `SELECT o.id, o.name AS organization_name,
              s.company_name, s.logo_url,
              s.customer_label, s.customer_label_plural,
              s.job_label, s.job_label_plural,
              s.booking_form_config
       FROM organizations o
       LEFT JOIN organization_settings s ON s.organization_id = o.id
       WHERE o.slug = $1 AND o.deleted_at IS NULL LIMIT 1`,
      [slug]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = rows[0];
    const cfg = row.booking_form_config || {};
    res.json({
      id: row.id,
      name: row.company_name || row.organization_name,
      logo_url: row.logo_url,
      customer_label: row.customer_label || 'Customer',
      customer_label_plural: row.customer_label_plural || 'Customers',
      job_label: row.job_label || 'Job',
      job_label_plural: row.job_label_plural || 'Jobs',
      booking_form_config: {
        show_phone: cfg.show_phone !== false,
        show_address: cfg.show_address !== false,
        show_notes: cfg.show_notes !== false,
        show_referred_by: cfg.show_referred_by === true,
        preferred_dates_mode: ['none', 'one', 'three'].includes(cfg.preferred_dates_mode) ? cfg.preferred_dates_mode : 'one',
        title: typeof cfg.title === 'string' ? cfg.title : '',
        subtitle: typeof cfg.subtitle === 'string' ? cfg.subtitle : '',
        service_placeholder: typeof cfg.service_placeholder === 'string' ? cfg.service_placeholder : '',
        notes_placeholder: typeof cfg.notes_placeholder === 'string' ? cfg.notes_placeholder : '',
      },
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
  // Accept up to 3 (date, window) slots. Back-compat: if caller sent the
  // legacy single preferred_date/preferred_time_window, treat that as one slot.
  let slotsRaw = Array.isArray(b.preferred_slots) ? b.preferred_slots.slice(0, 3) : [];
  if (slotsRaw.length === 0 && b.preferred_date) {
    slotsRaw = [{ date: b.preferred_date, window: b.preferred_time_window }];
  }
  const preferred_slots = slotsRaw
    .map((s) => {
      if (!s || typeof s !== 'object') return null;
      const date = typeof s.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : null;
      if (!date) return null;
      const window = TIME_WINDOWS.has(s.window) ? s.window : 'anytime';
      return { date, window };
    })
    .filter(Boolean);
  // Mirror the first slot into the legacy columns so older readers stay sane.
  const preferred_date = preferred_slots[0] ? preferred_slots[0].date : null;
  const preferred_time_window = preferred_slots[0] ? preferred_slots[0].window : 'anytime';
  const notes = (b.notes || '').trim() || null;
  const referred_by = (b.referred_by || '').trim().slice(0, 200) || null;

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
         service_description, preferred_date, preferred_time_window, notes, preferred_slots, referred_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
       RETURNING id, created_at`,
      [org.id, requester_name, requester_email, requester_phone, requester_address,
       service_description, preferred_date, preferred_time_window, notes, JSON.stringify(preferred_slots), referred_by]
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
        preferred_slots.length > 0
          ? `<p style="margin:12px 0 0;"><strong>Preferred ${preferred_slots.length > 1 ? 'dates' : 'date'}:</strong><br/>${preferred_slots.map((s) => `${escapeHtml(s.date)} (${escapeHtml(s.window)})`).join('<br/>')}</p>`
          : '',
        notes ? `<p style="margin:12px 0 0;">Notes:<br/>${escapeHtml(notes).replace(/\n/g, '<br/>')}</p>` : '',
        referred_by ? `<p style="margin:12px 0 0;">Referred by: ${escapeHtml(referred_by)}</p>` : '',
      ].filter(Boolean).join('');
      const html = `
        <!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif; padding:24px; max-width:600px;">
          <h2 style="margin:0 0 16px;">New booking request</h2>
          ${detailsHtml}
          <p style="margin:24px 0 0;"><a href="${appUrl}/requests" style="display:inline-block; background:#4a5e7a; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">Review in Field Manager</a></p>
        </body></html>
      `;
      const slotsText = preferred_slots.length > 0
        ? `\nPreferred: ${preferred_slots.map((s) => `${s.date} (${s.window})`).join(', ')}`
        : '';
      const text = `New booking request for ${orgDisplayName}\n\n${requester_name}\n${requester_email || ''}\n${requester_phone || ''}\n\n${service_description}${slotsText}\n\nReview: ${appUrl}/requests`;
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
         s.venmo_handle,
         s.payment_link_url
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

// Public quote viewer + accept/decline. Mirrors the invoice public flow:
// only sent/accepted/declined quotes are visible (drafts stay private),
// and accepting auto-promotes a prospect quote into a real customer so
// the operator just sees a fully-converted record in the app.
const QUOTE_PUBLIC_SELECT = `
  SELECT
    q.id, q.status, q.description, q.notes, q.line_items, q.created_at,
    q.prospect_name, q.prospect_email, q.prospect_phone, q.prospect_address,
    q.customer_id,
    c.first_name AS customer_first_name,
    c.last_name AS customer_last_name,
    c.business_name AS customer_business_name,
    c.email AS customer_email,
    c.phone AS customer_phone,
    c.address AS customer_address,
    o.name AS organization_name,
    s.company_name, s.logo_url,
    s.address AS company_address,
    s.phone AS company_phone,
    s.email AS company_email
  FROM quotes q
  JOIN organizations o ON o.id = q.organization_id
  LEFT JOIN customers c ON c.id = q.customer_id
  LEFT JOIN organization_settings s ON s.organization_id = q.organization_id
`;

router.get('/quotes/:id', async (req, res, next) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: 'Not found' });
  try {
    const { rows } = await query(
      `${QUOTE_PUBLIC_SELECT}
       WHERE q.id = $1
         AND q.deleted_at IS NULL
         AND q.status IN ('sent', 'accepted', 'declined')
       LIMIT 1`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

async function notifyOrgOfQuoteAction({ orgId, subject, html, text }) {
  const { rows: settingsRows } = await query(
    `SELECT s.email AS settings_email, s.company_name, o.name AS organization_name
     FROM organizations o
     LEFT JOIN organization_settings s ON s.organization_id = o.id
     WHERE o.id = $1 LIMIT 1`,
    [orgId]
  );
  const row = settingsRows[0] || {};
  let notifyTo = row.settings_email;
  if (!notifyTo) {
    const { rows: adminRows } = await query(
      `SELECT email FROM users WHERE organization_id = $1 AND role = 'admin' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
      [orgId]
    );
    notifyTo = adminRows[0] && adminRows[0].email;
  }
  if (!notifyTo) return;
  sendEmail({ to: notifyTo, subject, html, text })
    .catch((err) => console.warn('quote notification failed:', err.message));
}

router.post('/quotes/:id/accept', async (req, res, next) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: 'Not found' });
  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT q.*, o.name AS organization_name, s.company_name
         FROM quotes q
         JOIN organizations o ON o.id = q.organization_id
         LEFT JOIN organization_settings s ON s.organization_id = q.organization_id
         WHERE q.id = $1 AND q.deleted_at IS NULL LIMIT 1`,
        [id]
      );
      if (rows.length === 0) {
        const err = new Error('Not found'); err.status = 404; throw err;
      }
      const quote = rows[0];
      if (quote.status !== 'sent') {
        const err = new Error(`Quote is already ${quote.status}`); err.status = 400; throw err;
      }

      // Auto-promote: a prospect quote becomes a real customer the moment
      // the recipient accepts. The operator gets a notification with a
      // ready-to-invoice record instead of a half-converted prospect.
      let promotedCustomerId = null;
      if (!quote.customer_id) {
        const { first_name, last_name } = splitName(quote.prospect_name);
        const ins = await client.query(
          `INSERT INTO customers
            (organization_id, first_name, last_name, phone, email, address)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [quote.organization_id, first_name || null, last_name || null,
           quote.prospect_phone, quote.prospect_email, quote.prospect_address]
        );
        promotedCustomerId = ins.rows[0].id;
        await client.query(
          `UPDATE quotes SET
             customer_id = $2,
             prospect_name = NULL,
             prospect_email = NULL,
             prospect_phone = NULL,
             prospect_address = NULL,
             status = 'accepted',
             updated_at = NOW()
           WHERE id = $1`,
          [quote.id, promotedCustomerId]
        );
      } else {
        await client.query(
          `UPDATE quotes SET status = 'accepted', updated_at = NOW() WHERE id = $1`,
          [quote.id]
        );
      }
      return { quote, promotedCustomerId };
    });

    const q = result.quote;
    const orgDisplay = q.company_name || q.organization_name;
    const accepterName = q.prospect_name
      || [q.customer_first_name, q.customer_last_name].filter(Boolean).join(' ')
      || 'A recipient';
    const appUrl = process.env.APP_URL || 'https://fieldmgr.com';
    const total = (q.line_items || []).reduce((sum, li) => sum + (parseFloat(li.amount) || 0), 0);
    const promotedNote = result.promotedCustomerId
      ? `<p style="margin:12px 0 0;">They were also added to your ${orgDisplay} customer list.</p>`
      : '';
    const html = `
      <!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif; padding:24px; max-width:600px;">
        <h2 style="margin:0 0 16px;">Quote accepted</h2>
        <p style="margin:0 0 6px;"><strong>${escapeHtml(accepterName)}</strong> accepted your quote ($${total.toFixed(2)}).</p>
        ${q.description ? `<p style="margin:12px 0 0;">${escapeHtml(q.description)}</p>` : ''}
        ${promotedNote}
        <p style="margin:24px 0 0;"><a href="${appUrl}/quotes" style="display:inline-block; background:#4a5e7a; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">Open in Field Manager</a></p>
      </body></html>
    `;
    const text = `${accepterName} accepted your quote for ${orgDisplay} ($${total.toFixed(2)}).\n\n${q.description || ''}\n\nOpen: ${appUrl}/quotes`;
    notifyOrgOfQuoteAction({
      orgId: q.organization_id,
      subject: `${accepterName} accepted your quote`,
      html, text,
    });

    res.json({ ok: true, promoted_customer_id: result.promotedCustomerId });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/quotes/:id/decline', async (req, res, next) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: 'Not found' });
  const reason = (req.body && req.body.reason ? String(req.body.reason).trim().slice(0, 500) : '') || null;
  try {
    const { rows } = await query(
      `SELECT q.id, q.status, q.organization_id, q.description, q.prospect_name,
              c.first_name AS customer_first_name, c.last_name AS customer_last_name,
              o.name AS organization_name, s.company_name
       FROM quotes q
       JOIN organizations o ON o.id = q.organization_id
       LEFT JOIN customers c ON c.id = q.customer_id
       LEFT JOIN organization_settings s ON s.organization_id = q.organization_id
       WHERE q.id = $1 AND q.deleted_at IS NULL LIMIT 1`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const quote = rows[0];
    if (quote.status !== 'sent') return res.status(400).json({ error: `Quote is already ${quote.status}` });

    await query(
      `UPDATE quotes SET status = 'declined', updated_at = NOW() WHERE id = $1`,
      [id]
    );

    const orgDisplay = quote.company_name || quote.organization_name;
    const declinerName = quote.prospect_name
      || [quote.customer_first_name, quote.customer_last_name].filter(Boolean).join(' ')
      || 'A recipient';
    const appUrl = process.env.APP_URL || 'https://fieldmgr.com';
    const html = `
      <!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif; padding:24px; max-width:600px;">
        <h2 style="margin:0 0 16px;">Quote declined</h2>
        <p style="margin:0 0 6px;"><strong>${escapeHtml(declinerName)}</strong> declined your quote.</p>
        ${quote.description ? `<p style="margin:12px 0 0;">${escapeHtml(quote.description)}</p>` : ''}
        ${reason ? `<p style="margin:12px 0 0;"><strong>Reason:</strong><br/>${escapeHtml(reason).replace(/\n/g, '<br/>')}</p>` : ''}
        <p style="margin:24px 0 0;"><a href="${appUrl}/quotes" style="display:inline-block; background:#4a5e7a; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">Open in Field Manager</a></p>
      </body></html>
    `;
    const text = `${declinerName} declined your quote for ${orgDisplay}.${reason ? `\n\nReason: ${reason}` : ''}\n\nOpen: ${appUrl}/quotes`;
    notifyOrgOfQuoteAction({
      orgId: quote.organization_id,
      subject: `${declinerName} declined your quote`,
      html, text,
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: '', last_name: '' };
  if (parts.length === 1) return { first_name: parts[0], last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

module.exports = router;
