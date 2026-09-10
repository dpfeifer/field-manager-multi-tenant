// Standalone booking form: server-rendered HTML, no React, no app bundle.
//
// /book/<slug> used to fall through to the SPA catch-all, which meant a public
// conversion page — and anything embedding it on a customer's own site —
// pulled the whole ~540KB application to draw a contact form. This renders the
// same form as plain HTML posting to the existing public API, so the page is a
// few KB and paints immediately on a phone.
//
// It is also the one page in the app that is allowed to be framed, so a client
// who doesn't want a hosted landing page can drop it into their own site. See
// the framing exception in app.js — it is scoped to this path deliberately;
// the authenticated app must never be embeddable.

const { query } = require('./config/db');

const SLUG_RE = /^[a-z0-9-]{1,60}$/i;

const TIME_WINDOWS = [
  ['anytime', 'Anytime'],
  ['morning', 'Morning'],
  ['afternoon', 'Afternoon'],
  ['evening', 'Evening'],
];

// Everything interpolated into the page is org-controlled text, so it is
// escaped rather than trusted — a company name with an apostrophe or an angle
// bracket must not be able to break the markup.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeConfig(v) {
  const c = (v && typeof v === 'object') ? v : {};
  return {
    show_phone: c.show_phone !== false,
    show_address: c.show_address !== false,
    show_notes: c.show_notes !== false,
    show_referred_by: c.show_referred_by === true,
    preferred_dates_mode: ['none', 'one', 'three'].includes(c.preferred_dates_mode)
      ? c.preferred_dates_mode : 'one',
    title: typeof c.title === 'string' ? c.title : '',
    subtitle: typeof c.subtitle === 'string' ? c.subtitle : '',
    service_placeholder: typeof c.service_placeholder === 'string' ? c.service_placeholder : '',
    notes_placeholder: typeof c.notes_placeholder === 'string' ? c.notes_placeholder : '',
  };
}

async function loadOrg(slug) {
  const { rows } = await query(
    `SELECT o.id, o.name AS organization_name,
            s.company_name, s.logo_url, s.phone, s.email,
            s.booking_form_config
     FROM organizations o
     LEFT JOIN organization_settings s ON s.organization_id = o.id
     WHERE o.slug = $1 AND o.deleted_at IS NULL
     LIMIT 1`,
    [slug]
  );
  return rows[0] || null;
}

function renderPage({ slug, org, appUrl }) {
  const cfg = normalizeConfig(org.booking_form_config);
  const company = org.company_name || org.organization_name || 'us';
  const heading = cfg.title || `Request a booking with ${company}`;
  const sub = cfg.subtitle || 'Fill out a short form and we will get back to you to confirm.';
  const slots = cfg.preferred_dates_mode === 'three' ? 3
    : cfg.preferred_dates_mode === 'one' ? 1 : 0;

  const windowOptions = TIME_WINDOWS
    .map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

  const slotFields = Array.from({ length: slots }, (_, i) => `
      <div class="slot">
        <div class="f">
          <label for="d${i}">${slots > 1 ? `Preferred date ${i + 1}` : 'Preferred date'}
            <span class="opt">optional</span></label>
          <input type="date" id="d${i}" name="date${i}">
        </div>
        <div class="f">
          <label for="w${i}">Time</label>
          <select id="w${i}" name="window${i}">${windowOptions}</select>
        </div>
      </div>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(heading)}</title>
<meta name="robots" content="noindex">
<meta property="og:title" content="${esc(`Book a service with ${company}`)}">
<meta property="og:description" content="${esc(sub)}">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<style>
  :root {
    --bg: #f7f4ec; --card: #fff; --text: #19170f; --muted: #66635c;
    --border: #e8e1d1; --strong: #d4cab4; --primary: #2c3e57;
    --danger: #a23b2c; --danger-bg: #f9e3df;
    --success: #2d6b4a; --success-bg: #e1ede5;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font-family: 'Inter', -apple-system, BlinkMacFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 15px; line-height: 1.5; -webkit-font-smoothing: antialiased;
  }
  /* Embedded, the host page supplies the surrounding chrome, so the card
     drops its frame and sits flush. Toggled by ?embed=1. */
  .wrap { max-width: 560px; margin: 0 auto; padding: 32px 20px 48px; }
  body.embed .wrap { padding: 0; max-width: none; }
  .card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 14px; padding: 26px 24px;
  }
  body.embed .card { border: 0; border-radius: 0; padding: 4px 0; background: transparent; }
  .logo { max-height: 52px; max-width: 180px; margin-bottom: 16px; }
  h1 { font-size: 21px; line-height: 1.25; margin: 0 0 6px; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 14px; margin: 0 0 22px; }
  .f { margin-bottom: 14px; }
  label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 5px; }
  .opt { font-weight: 400; color: var(--muted); }
  input, select, textarea {
    width: 100%; font: inherit; font-size: 15px; color: var(--text);
    background: var(--card); border: 1px solid var(--strong);
    border-radius: 8px; padding: 10px 12px;
  }
  input:focus, select:focus, textarea:focus {
    outline: none; border-color: var(--primary);
    box-shadow: 0 0 0 3px rgba(44, 62, 87, 0.14);
  }
  textarea { min-height: 88px; resize: vertical; }
  .slot { display: grid; grid-template-columns: 1fr 150px; gap: 10px; }
  @media (max-width: 420px) { .slot { grid-template-columns: 1fr; gap: 0; } }
  button {
    width: 100%; font: inherit; font-size: 15px; font-weight: 600;
    color: #fff; background: var(--primary); border: 0;
    border-radius: 8px; padding: 12px 16px; cursor: pointer; margin-top: 6px;
  }
  button:hover { background: #1b2940; }
  button:disabled { opacity: 0.6; cursor: default; }
  .msg { border-radius: 8px; padding: 12px 14px; font-size: 14px; margin-bottom: 16px; }
  .msg.err { background: var(--danger-bg); color: var(--danger); }
  .done { background: var(--success-bg); color: var(--success); border-radius: 10px; padding: 22px 20px; text-align: center; }
  .done h2 { font-size: 18px; margin: 0 0 6px; }
  .done p { margin: 0; font-size: 14px; }
  .foot { text-align: center; font-size: 12px; color: var(--muted); margin-top: 18px; }
  .foot a { color: var(--muted); }
  body.embed .foot { margin-top: 12px; }
  /* Honeypot: present for bots, never shown or focusable for people. */
  .hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div id="form-wrap">
      ${org.logo_url ? `<img class="logo" src="${esc(org.logo_url)}" alt="${esc(company)}">` : ''}
      <h1>${esc(heading)}</h1>
      <p class="sub">${esc(sub)}</p>
      <div id="err" class="msg err" style="display:none" role="alert"></div>
      <form id="f" novalidate>
        <div class="f">
          <label for="name">Your name</label>
          <input id="name" name="requester_name" autocomplete="name" required>
        </div>
        <div class="f">
          <label for="email">Email</label>
          <input type="email" id="email" name="requester_email" autocomplete="email">
        </div>
        ${cfg.show_phone ? `
        <div class="f">
          <label for="phone">Phone</label>
          <input type="tel" id="phone" name="requester_phone" autocomplete="tel">
        </div>` : ''}
        ${cfg.show_address ? `
        <div class="f">
          <label for="addr">Address <span class="opt">optional</span></label>
          <input id="addr" name="requester_address" autocomplete="street-address">
        </div>` : ''}
        <div class="f">
          <label for="svc">What do you need?</label>
          <textarea id="svc" name="service_description"
            placeholder="${esc(cfg.service_placeholder)}" required></textarea>
        </div>
        ${slotFields}
        ${cfg.show_notes ? `
        <div class="f">
          <label for="notes">Anything else? <span class="opt">optional</span></label>
          <textarea id="notes" name="notes" placeholder="${esc(cfg.notes_placeholder)}"></textarea>
        </div>` : ''}
        ${cfg.show_referred_by ? `
        <div class="f">
          <label for="ref">How did you hear about us? <span class="opt">optional</span></label>
          <input id="ref" name="referred_by">
        </div>` : ''}
        <div class="hp" aria-hidden="true">
          <label for="website">Leave this empty</label>
          <input id="website" name="website" tabindex="-1" autocomplete="off">
        </div>
        <button type="submit" id="submit">Send request</button>
      </form>
    </div>
  </div>
  <p class="foot">Powered by <a href="${esc(appUrl)}" target="_blank" rel="noopener">Field Manager</a></p>
</div>
<script>
(function () {
  var slots = ${slots};
  var params = new URLSearchParams(location.search);
  if (params.get('embed') === '1') document.body.classList.add('embed');

  // Tell a host page how tall we are, so an embed can size its iframe and
  // never shows an inner scrollbar. Sent on load, on resize, and after the
  // form is replaced by the confirmation.
  function postHeight() {
    if (window.parent === window) return;
    var h = document.documentElement.scrollHeight;
    try { window.parent.postMessage({ type: 'fieldmgr:height', height: h }, '*'); } catch (e) {}
  }
  window.addEventListener('load', postHeight);
  window.addEventListener('resize', postHeight);
  setInterval(postHeight, 1000);

  var form = document.getElementById('f');
  var errBox = document.getElementById('err');
  var btn = document.getElementById('submit');

  function showError(msg) {
    errBox.textContent = msg;
    errBox.style.display = 'block';
    postHeight();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errBox.style.display = 'none';

    var get = function (n) { var el = form.elements[n]; return el ? el.value.trim() : ''; };
    var body = {
      requester_name: get('requester_name'),
      requester_email: get('requester_email'),
      requester_phone: get('requester_phone'),
      requester_address: get('requester_address'),
      service_description: get('service_description'),
      notes: get('notes'),
      referred_by: get('referred_by'),
      website: get('website')
    };

    var picked = [];
    for (var i = 0; i < slots; i++) {
      var d = get('date' + i);
      if (d) picked.push({ date: d, window: get('window' + i) || 'anytime' });
    }
    if (picked.length) body.preferred_slots = picked;

    // Checked here as well as on the server so the message appears instantly
    // rather than after a round trip; the server remains the authority.
    if (!body.requester_name) return showError('Please tell us your name.');
    if (!body.requester_email && !body.requester_phone) {
      return showError('Please add an email or phone number so we can reach you.');
    }
    if (!body.service_description) return showError('Please tell us what you need.');

    btn.disabled = true;
    btn.textContent = 'Sending...';

    fetch('/api/public/book/' + ${JSON.stringify(slug)}, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, data: d }; });
    }).then(function (res) {
      if (!res.ok) throw new Error((res.data && res.data.error) || 'Something went wrong.');
      document.getElementById('form-wrap').innerHTML =
        '<div class="done"><h2>Request sent</h2>' +
        '<p>Thanks &mdash; we\\'ll be in touch to confirm.</p></div>';
      postHeight();
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = 'Send request';
      showError(err.message || 'Something went wrong. Please try again.');
    });
  });
})();
</script>
</body>
</html>`;
}

function notFoundPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found</title>
<style>body{margin:0;background:#f7f4ec;color:#19170f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px}</style>
</head><body><div><h1 style="font-size:19px;margin:0 0 6px">This booking link isn&#39;t active</h1>
<p style="color:#66635c;margin:0;font-size:14px">Check the address, or contact the business directly.</p></div></body></html>`;
}

module.exports = { SLUG_RE, loadOrg, renderPage, notFoundPage };
