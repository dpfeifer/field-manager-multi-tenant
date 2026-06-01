const { query } = require('../config/db');

const DEFAULTS = {
  email_verification: {
    subject: 'Verify your Field Manager email',
    intro_html: `<p>Welcome to Field Manager, {{user_name}}!</p>
<p>Confirm your email address so we know you're you. The link below expires in 24 hours.</p>`,
    intro_text: `Welcome to Field Manager, {{user_name}}!

Confirm your email address so we know you're you. The link below expires in 24 hours.

{{verify_url}}`,
  },
  trial_reminder_3d: {
    subject: 'Your Field Manager trial ends in 3 days',
    intro_html: `<p>Hi {{user_name}},</p>
<p>Your free trial for <strong>{{organization_name}}</strong> ends in <strong>3 days</strong> (on {{trial_ends_on}}). After that, you'll need an active subscription to keep editing.</p>
<p>Mark complete on visits will keep working either way — your crew won't get locked out.</p>`,
    intro_text: `Hi {{user_name}},

Your free trial for {{organization_name}} ends in 3 days (on {{trial_ends_on}}). After that, you'll need an active subscription to keep editing.

Mark complete on visits will keep working either way — your crew won't get locked out.

Subscribe now: {{billing_url}}`,
  },
  trial_reminder_1d: {
    subject: 'Your Field Manager trial ends tomorrow',
    intro_html: `<p>Hi {{user_name}},</p>
<p>Heads up — your free trial for <strong>{{organization_name}}</strong> ends <strong>tomorrow</strong>. Subscribe today to avoid the lockout on editing.</p>`,
    intro_text: `Hi {{user_name}},

Heads up — your free trial for {{organization_name}} ends tomorrow. Subscribe today to avoid the lockout on editing.

Subscribe: {{billing_url}}`,
  },
  trial_expired: {
    subject: 'Your Field Manager trial has ended',
    intro_html: `<p>Hi {{user_name}},</p>
<p>The free trial for <strong>{{organization_name}}</strong> has ended. Editing is now locked, but your crew can still record completed visits.</p>
<p>Subscribe to restore editing — your data is safe and waiting.</p>`,
    intro_text: `Hi {{user_name}},

The free trial for {{organization_name}} has ended. Editing is now locked, but your crew can still record completed visits.

Subscribe to restore editing — your data is safe and waiting.

{{billing_url}}`,
  },
};

const EDITABLE_KEYS = Object.keys(DEFAULTS);

function substitute(text, vars) {
  if (!text) return '';
  return Object.entries(vars || {}).reduce(
    (s, [k, v]) => s.split(`{{${k}}}`).join(v == null ? '' : String(v)),
    text
  );
}

async function getTemplate(key) {
  const fallback = DEFAULTS[key];
  if (!fallback) throw new Error(`Unknown template: ${key}`);
  try {
    const { rows } = await query(
      'SELECT subject, intro_html, intro_text FROM email_templates WHERE template_key = $1 LIMIT 1',
      [key]
    );
    if (rows.length === 0) return fallback;
    return rows[0];
  } catch (err) {
    console.error(`getTemplate(${key}) failed, using default:`, err.message);
    return fallback;
  }
}

async function listTemplates() {
  const { rows } = await query(
    'SELECT template_key, subject, intro_html, intro_text, updated_at FROM email_templates ORDER BY template_key'
  );
  const overrides = Object.fromEntries(rows.map((r) => [r.template_key, r]));
  return EDITABLE_KEYS.map((key) => {
    const override = overrides[key];
    const def = DEFAULTS[key];
    return {
      template_key: key,
      subject: override ? override.subject : def.subject,
      intro_html: override ? override.intro_html : def.intro_html,
      intro_text: override ? override.intro_text : def.intro_text,
      updated_at: override ? override.updated_at : null,
      is_default: !override,
    };
  });
}

async function saveTemplate(key, { subject, intro_html, intro_text }) {
  if (!DEFAULTS[key]) throw new Error(`Unknown template: ${key}`);
  await query(
    `INSERT INTO email_templates (template_key, subject, intro_html, intro_text, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (template_key) DO UPDATE SET
       subject = EXCLUDED.subject,
       intro_html = EXCLUDED.intro_html,
       intro_text = EXCLUDED.intro_text,
       updated_at = NOW()`,
    [key, subject, intro_html, intro_text]
  );
}

async function resetTemplate(key) {
  await query('DELETE FROM email_templates WHERE template_key = $1', [key]);
}

module.exports = {
  DEFAULTS,
  EDITABLE_KEYS,
  substitute,
  getTemplate,
  listTemplates,
  saveTemplate,
  resetTemplate,
};
