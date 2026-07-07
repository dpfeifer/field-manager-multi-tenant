const express = require('express');
const { query } = require('../config/db');
const { requireRole } = require('../middleware/auth');
const { cloudinarySignature } = require('../utils/cloudinary');
const { normalizeLandingPageConfig } = require('../utils/landing');

const router = express.Router();

// Cloudinary signed-upload signature for org admins (logo uploads etc.).
router.post('/upload-signature', requireRole('admin'), (req, res) => {
  const sig = cloudinarySignature();
  if (!sig) return res.status(503).json({ error: 'Image uploads are not configured' });
  res.json(sig);
});

const FIELDS = [
  'company_name', 'logo_url', 'address', 'phone', 'email',
  'venmo_handle', 'payment_link_url', 'resend_from_email', 'cloudinary_folder',
  'customer_label', 'customer_label_plural', 'job_label', 'job_label_plural',
  'about', 'sms_templates', 'dashboard_widgets',
  'auto_invoice_schedule', 'auto_invoice_day_of_month', 'auto_invoice_day_of_week',
  'auto_append_to_draft',
  'booking_form_config',
];

const SELECT = `
  SELECT company_name, logo_url, address, phone, email,
         venmo_handle, payment_link_url, resend_from_email, cloudinary_folder,
         customer_label, customer_label_plural, job_label, job_label_plural,
         about, sms_templates, dashboard_widgets,
         auto_invoice_schedule, auto_invoice_day_of_month,
         auto_invoice_day_of_week, auto_invoice_last_run_at,
         auto_append_to_draft,
         booking_form_config, landing_page_config,
         updated_at
  FROM organization_settings WHERE organization_id = $1 LIMIT 1
`;

function emptyDefaults() {
  return FIELDS.reduce((acc, f) => ({ ...acc, [f]: null }), { updated_at: null });
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(SELECT, [req.organization.id]);
    const out = rows[0] || emptyDefaults();
    // Landing-page feature entitlement lives on the org (system-admin set).
    const org = await query('SELECT landing_enabled FROM organizations WHERE id = $1', [req.organization.id]);
    out.landing_enabled = !!(org.rows[0] && org.rows[0].landing_enabled);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// Tenant self-serve landing-page editor — only when the org has been granted
// the feature (landing_enabled). Shares the config validation with the staff
// editor; org admins only.
router.put('/landing', requireRole('admin'), async (req, res, next) => {
  try {
    const org = await query(
      'SELECT landing_enabled FROM organizations WHERE id = $1',
      [req.organization.id]
    );
    if (!org.rows[0] || !org.rows[0].landing_enabled) {
      return res.status(403).json({ error: 'The landing-page feature is not enabled for your account.' });
    }
    const cfg = normalizeLandingPageConfig(req.body);
    await query(
      `INSERT INTO organization_settings (organization_id, landing_page_config)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (organization_id)
       DO UPDATE SET landing_page_config = $2::jsonb, updated_at = NOW()`,
      [req.organization.id, JSON.stringify(cfg)]
    );
    res.json({ ok: true, landing_page_config: cfg });
  } catch (err) { next(err); }
});

const TERMINOLOGY_FIELDS = new Set([
  'customer_label', 'customer_label_plural', 'job_label', 'job_label_plural',
]);

// Normalize a user-typed terminology label: trim, and if the value is
// entirely uppercase letters (e.g. 'CLIENTS') down-case all but the first
// letter so the nav doesn't read as shouting. Otherwise leave the user's
// casing alone so 'eBook' or 'pet-sitter' survive unchanged.
const VALID_WIDGET_IDS = new Set([
  'greeting', 'team_notes', 'stats', 'today', 'tomorrow', 'overdue', 'outstanding',
  'pending_requests', 'quick_actions', 'top_customers',
]);
function normalizeDashboardWidgets(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const w of value) {
    if (!w || typeof w !== 'object' || !VALID_WIDGET_IDS.has(w.id) || seen.has(w.id)) continue;
    seen.add(w.id);
    out.push({ id: w.id, enabled: !!w.enabled });
  }
  // Append any valid IDs the client omitted (disabled by default) so saving a
  // subset doesn't strand widgets out of reach.
  for (const id of VALID_WIDGET_IDS) {
    if (!seen.has(id)) out.push({ id, enabled: false });
  }
  return out;
}

function normalizeBookingFormConfig(value) {
  const v = (value && typeof value === 'object') ? value : {};
  const mode = ['none', 'one', 'three'].includes(v.preferred_dates_mode) ? v.preferred_dates_mode : 'one';
  return {
    show_phone: v.show_phone !== false,
    show_address: v.show_address !== false,
    show_notes: v.show_notes !== false,
    show_referred_by: v.show_referred_by === true,
    preferred_dates_mode: mode,
    title: typeof v.title === 'string' ? v.title.slice(0, 120) : '',
    subtitle: typeof v.subtitle === 'string' ? v.subtitle.slice(0, 280) : '',
    service_placeholder: typeof v.service_placeholder === 'string' ? v.service_placeholder.slice(0, 200) : '',
    notes_placeholder: typeof v.notes_placeholder === 'string' ? v.notes_placeholder.slice(0, 200) : '',
  };
}

function normalizeSmsTemplates(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t) => t && typeof t === 'object')
    .map((t) => ({
      id: typeof t.id === 'string' && t.id.length <= 32 ? t.id : 'tpl_' + Math.random().toString(36).slice(2, 9),
      label: typeof t.label === 'string' ? t.label.trim().slice(0, 80) : '',
      message: typeof t.message === 'string' ? t.message.trim().slice(0, 1000) : '',
    }))
    .filter((t) => t.label && t.message)
    .slice(0, 24);
}

function normalizeLabel(v) {
  if (typeof v !== 'string') return v;
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (trimmed === trimmed.toUpperCase() && trimmed !== trimmed.toLowerCase()) {
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  }
  return trimmed;
}

router.put('/', requireRole('admin'), async (req, res, next) => {
  const body = req.body || {};
  const setClauses = [];
  const values = [req.organization.id];

  FIELDS.forEach((f) => {
    if (Object.prototype.hasOwnProperty.call(body, f)) {
      let v = body[f] === '' ? null : body[f];
      if (TERMINOLOGY_FIELDS.has(f)) v = normalizeLabel(v);
      if (f === 'sms_templates') v = JSON.stringify(normalizeSmsTemplates(v));
      if (f === 'dashboard_widgets') v = JSON.stringify(normalizeDashboardWidgets(v));
      if (f === 'booking_form_config') v = JSON.stringify(normalizeBookingFormConfig(v));
      values.push(v);
      setClauses.push(`${f} = $${values.length}`);
    }
  });

  try {
    await query(
      'INSERT INTO organization_settings (organization_id) VALUES ($1) ON CONFLICT (organization_id) DO NOTHING',
      [req.organization.id]
    );

    if (setClauses.length > 0) {
      await query(
        `UPDATE organization_settings SET ${setClauses.join(', ')}, updated_at = NOW()
         WHERE organization_id = $1`,
        values
      );
    }

    const { rows } = await query(SELECT, [req.organization.id]);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
