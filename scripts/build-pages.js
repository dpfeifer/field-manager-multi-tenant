#!/usr/bin/env node
/**
 * Static content pages: content/*.md -> public/_pages/*.html + manifest.
 *
 * Each markdown file carries frontmatter (title, description, path, eyebrow,
 * date). The build renders it into a self-contained HTML page styled like the
 * marketing site, writes a manifest mapping URL path -> file (served by
 * src/app.js ahead of the SPA catch-all, so crawlers get real HTML), generates
 * a /learn index from the pages under /learn/, and rewrites sitemap.xml.
 *
 * Add a page: drop a .md file in content/ and deploy. No other wiring.
 */
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const ROOT = path.join(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const PUBLIC_DIR = path.join(ROOT, 'public');
const OUT_DIR = path.join(PUBLIC_DIR, '_pages');
const BASE_URL = 'https://fieldmgr.com';

function fail(msg) { console.error(`[build-pages] ${msg}`); process.exit(1); }

function parseFrontmatter(raw, file) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) fail(`${file}: missing frontmatter block`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  for (const req of ['title', 'description', 'path']) {
    if (!meta[req]) fail(`${file}: frontmatter needs "${req}"`);
  }
  if (!/^\/[a-z0-9/-]*$/.test(meta.path)) fail(`${file}: path must be a clean absolute path`);
  return { meta, body: m[2] };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const unsplash = (id, w = 1400) =>
  `https://images.unsplash.com/${id}?w=${w}&q=75&auto=format&fit=crop`;

// Product shots drawn in markup, not screenshots: nothing to keep in sync
// with the app's real data, no customer information can leak, and they stay
// crisp at any density. They are the landing page's phone — the same frame,
// glass and tab bar — and the CSS is lifted out of public/index.html at build
// time (see PHONE_CSS) so the two cannot drift apart. Authors drop
// {{mock:name}} on its own line, or name one in a {{chapter:name}} block.
const ICON_PATHS = {
  dashboard: 'M3 9.6 12 3l9 6.6V20a1 1 0 0 1-1 1h-5v-6.5H9V21H4a1 1 0 0 1-1-1z',
  jobs: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  customers: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  more: 'M4 7h16M4 12h16M4 17h16',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON_PATHS[name]}"/></svg>`;
const DOLLAR = '<svg class="icon icon-glyph" viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="12" text-anchor="middle" dominant-baseline="central">$</text></svg>';
const ACTIONS = '<div class="pd-acts"><span class="pd-gc pd-glass"><span>+</span></span><span class="pd-gc pd-glass"><span>···</span></span></div>';
const initials = (name) => name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

// tab: which of the bar's five cells is lit (0 home · 1 calendar · 2 people ·
// 3 money · 4 more). chrome:false is a public page — no app bar, no tab bar.
function phone({ label, company, tab = 0, chrome = true, body }) {
  return `<div class="pd-phone" role="img" aria-label="${esc(label)}">
  <div class="pd-scr"><div class="pd-app" aria-hidden="true">
    ${chrome ? `<div class="pd-top pd-glass"><b>${esc(company)}</b><span class="pd-av"><i>${esc(initials(company)[0] || 'S')}</i></span></div>` : ''}
    <div class="pd-view on${chrome ? '' : ' pd-view--page'}">${body}</div>
    ${chrome ? `<div class="pd-bar pd-glass"><div class="pd-in" style="--pd-i:${tab}"><span class="pd-pill"></span>
      <span class="pd-t">${icon('dashboard')}</span><span class="pd-t">${icon('jobs')}</span><span class="pd-t">${icon('customers')}</span><span class="pd-t">${DOLLAR}</span><span class="pd-t">${icon('more')}</span>
    </div></div>` : ''}
  </div></div>
</div>`;
}

// The calendar's day view at 80px to the hour. Jobs: [minutes past 8 AM,
// length in minutes, time label, price, title, who].
function dayGrid(jobs, nowMinutes) {
  const H = 80;
  const hours = ['8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM'];
  return `<div class="pd-day">
    <div class="pd-day-hrs">${hours.map((h) => `<div style="height:${H}px"><span>${h}</span></div>`).join('')}</div>
    <div class="pd-day-lanes" style="height:${hours.length * H}px">
      ${hours.map(() => `<div class="pd-day-lane" style="height:${H}px"></div>`).join('')}
      <div class="pd-day-now" style="top:${(nowMinutes / 60) * H}px"><i></i><b></b></div>
      ${jobs.map(([at, dur, time, price, title, who]) => `<div class="pd-day-blk" style="top:${(at / 60) * H}px;height:${(dur / 60) * H - 2}px">
        <div class="pd-day-hd"><span>${time}</span><em>${price}</em></div>
        <div class="pd-day-ti">${esc(title)}</div>
        <div class="pd-day-bt"><span>${esc(who)}</span><u>Mark complete</u></div>
      </div>`).join('')}
    </div>
  </div>`;
}
const rows = (items) => `<div class="pd-lst">${items.join('')}</div>`;

const MOCKS = {
  route: (company) => phone({
    label: 'The day view of the calendar, with three timed visits', company, tab: 1,
    body: `<div class="pd-tb"><div><h5>Calendar</h5><div class="pd-c">Tue, Sep 15 · <b>3 visits</b> · <b>$245</b></div></div>${ACTIONS}</div>
      <div class="pd-seg"><span>Month</span><span>Week</span><span class="on">Day</span></div>
      ${dayGrid([
        [0, 60, '8:00 AM', '$65', 'Weekly service', 'Heather Stahl'],
        [150, 90, '10:30 AM', '$120', 'Weekly service', 'Marcus Bell'],
        [300, 60, '1:00 PM', '$60', 'Weekly service', 'Riverbend HOA'],
      ], 80)}`,
  }),
  invoices: (company) => phone({
    label: 'The invoices list, with drafts ready to send', company, tab: 3,
    body: `<div class="pd-tb"><div><h5>Invoices</h5><div class="pd-c">8 total · <b>$610</b> in drafts</div></div>${ACTIONS}</div>
      <div class="pd-seg"><span>All 8</span><span>Unpaid 2</span><span class="on">Draft 3</span><span>Paid 3</span></div>
      ${rows([['#1041', 'Heather Stahl', '$220.00'], ['#1042', 'Marcus Bell', '$130.00'], ['#1043', 'Dee Whitfield', '$260.00']].map(([n, who, amt]) =>
        `<div class="pd-ro"><span class="pd-inv">${n}</span><div class="pd-fill"><div class="pd-nm">${who}</div><div class="pd-mt"><span class="pd-bdg draft">draft</span> ${amt}</div></div><span class="pd-mc pd-mc--quiet">Mark sent</span></div>`))}`,
  }),
  booking: (company) => phone({
    label: 'The public booking page, filled in by a new customer', company, chrome: false,
    body: `<div class="pd-book">
      <div class="pd-book-logo">${esc(initials(company))}</div>
      <h5>Book with ${esc(company)}</h5>
      <p>Tell us what you need and when. We’ll confirm by text.</p>
      <label>Your name</label><div class="pd-field">Marcus Bell</div>
      <label>Phone</label><div class="pd-field">555-664-2211</div>
      <label>What do you need?</label><div class="pd-field pd-field--tall">Full service, this week if you can</div>
      <label>Preferred date</label><div class="pd-field">Thu, 4:00 PM</div>
      <div class="pd-submit">Request a booking</div>
    </div>`,
  }),
  client: (company) => phone({
    label: 'One customer’s page: past visits, what each cost, and notes', company, tab: 2,
    body: `<div class="pd-tb"><div><h5>Marcus Bell</h5><div class="pd-c">Customer since March · <b>$125</b> this summer</div></div></div>
      <div class="pd-seg"><span class="on">Jobs 3</span><span>Invoices 3</span><span>Notes 1</span></div>
      ${rows([['Jul 18', 'Full service', '$45.00'], ['Jun 27', 'Standard', '$35.00'], ['Jun 6', 'Full service', '$45.00']].map(([d, t, amt]) =>
        `<div class="pd-ro"><div class="pd-fill"><div class="pd-nm">${t}</div><div class="pd-mt">Completed ${d}</div></div><span class="pd-earn" style="color:var(--text)">${amt}</span></div>`))}
      <div class="pd-sec">Notes</div>
      ${rows(['<div class="pd-ro"><div class="pd-fill"><div class="pd-nm">Same as last time</div><div class="pd-mt">Prefers late afternoon. Text, don’t call.</div></div></div>'])}`,
  }),
  quote: (company) => phone({
    label: 'An accepted quote, one tap from becoming a job and an invoice', company, tab: 4,
    body: `<div class="pd-tb"><div><h5>Quote #308</h5><div class="pd-c">Dee Whitfield · <b>accepted</b> online</div></div><span class="pd-credit">Accepted</span></div>
      ${rows([['Labor · 6 hrs', '$390.00'], ['Materials', '$145.00']].map(([t, amt]) =>
        `<div class="pd-ro"><div class="pd-fill"><div class="pd-nm">${t}</div></div><span class="pd-earn" style="color:var(--text)">${amt}</span></div>`)
        .concat('<div class="pd-ro"><div class="pd-fill"><div class="pd-nm">Total</div></div><span class="pd-earn" style="color:var(--text);font-size:17px">$535.00</span></div>'))}
      <div class="pd-submit" style="margin-top:14px">Create job</div>
      <div class="pd-submit" style="margin-top:8px;background:#fff;color:var(--text);border:1px solid var(--border)">Create invoice</div>`,
  }),
  referrals: (company) => phone({
    label: 'A customer’s referrals: their link, who they sent, and the credit earned', company, tab: 2,
    body: `<div class="pd-tb"><div><h5>Heather Stahl</h5><div class="pd-c">3 referred · <b>$61.50</b> earned</div></div><span class="pd-credit">$61.50 credit</span></div>
      <div class="pd-seg"><span>Jobs 3</span><span>Invoices 6</span><span class="on">Referrals 3</span></div>
      <div class="pd-link"><div class="pd-l">Heather’s referral link</div><div class="pd-link-row"><span>fieldmgr.com/book/you?ref=N9MJAX7R</span><b>Copy</b></div></div>
      ${rows([['Marcus Bell', '5 rewards earned', '+$27.50'], ['Dee Whitfield', '4 rewards earned', '+$34.00'], ['Riverbend HOA', 'No rewards yet', '']].map(([n, m, amt]) =>
        `<div class="pd-ro"><div class="pd-fill"><div class="pd-nm">${n}</div><div class="pd-mt">${m}</div></div>${amt ? `<span class="pd-earn">${amt}</span>` : ''}</div>`))}`,
  }),
};

// The phone's CSS, cut from the landing page's stylesheet rather than copied:
// one source, so a change to the app's look reaches these pages on the next
// build. Fails the build loudly if the block ever moves.
const PHONE_CSS = (() => {
  const css = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const start = css.indexOf('/* ---- the phone ---- */');
  const endMark = '@media (prefers-reduced-motion: reduce) { .pd-view, .pd-pill';
  const end = css.indexOf(endMark, start);
  if (start < 0 || end < 0) fail('could not find the phone CSS block in public/index.html');
  return css.slice(start, css.indexOf('\n', end));
})();

// Feature rows. Authored as a block in the markdown, parsed BEFORE marked so
// the prose still renders as markdown:
//
//   {{chapter:route}}
//   Title line
//   Prose, which may run to several paragraphs.
//   {{/chapter}}
//
// Prose sits left, the mock right — the landing page's chapter layout.
function extractChapters(md, file) {
  const chapters = [];
  const out = md.replace(/\{\{chapter:([a-z]+)\}\}\n([\s\S]*?)\n\{\{\/chapter\}\}/g, (_m, mock, inner) => {
    if (!MOCKS[mock]) fail(`${file}: unknown mock "${mock}" in chapter block`);
    const lines = inner.split('\n');
    const title = (lines.shift() || '').trim();
    const prose = lines.join('\n').trim();
    if (!title) fail(`${file}: chapter needs a title line`);
    chapters.push({ mock, title, prose });
    return `\n\n{{CHAPTER_${chapters.length - 1}}}\n\n`;
  });
  return { md: out, chapters };
}

function renderChapters(html, chapters, company) {
  return html.replace(/<p>\{\{CHAPTER_(\d+)\}\}<\/p>|\{\{CHAPTER_(\d+)\}\}/g, (_m, a, b) => {
    const n = Number(a ?? b);
    const c = chapters[n];
    // Alternate sides, as the landing page's chapters do. A class rather than
    // :nth-child — other article content can sit between two chapters.
    return `<section class="page-chapter${n % 2 ? ' page-chapter--flip' : ''}">
  <div class="ed-chapter-body-col">
    <h2 class="ed-chapter-title">${esc(c.title)}</h2>
    <div class="ed-chapter-prose">${marked.parse(c.prose)}</div>
  </div>
  <div class="ed-chapter-mock">${MOCKS[c.mock](company)}</div>
</section>`;
  });
}

// Questions and answers, authored once and used twice: as visible text on the
// page and as FAQPage structured data. Search results and AI assistants both
// lift direct answers to direct questions, so each answer must stand alone
// and be true. Syntax, on its own lines:
//
//   {{faq}}
//   Q: Does it charge per user?
//   A: No. One flat price covers your whole crew.
//   {{/faq}}
function extractFaq(md, file) {
  const faqs = [];
  const out = md.replace(/\{\{faq\}\}\n([\s\S]*?)\n\{\{\/faq\}\}/g, (_m, inner) => {
    const lines = inner.split('\n').map((l) => l.trim()).filter(Boolean);
    let q = null;
    for (const l of lines) {
      if (/^Q:\s*/.test(l)) q = l.replace(/^Q:\s*/, '');
      else if (/^A:\s*/.test(l) && q) { faqs.push({ q, a: l.replace(/^A:\s*/, '') }); q = null; }
      else if (faqs.length && !q) faqs[faqs.length - 1].a += ' ' + l;
      else fail(`${file}: faq block line is neither "Q:" nor "A:": ${l.slice(0, 40)}`);
    }
    return '\n\n{{FAQ_BLOCK}}\n\n';
  });
  return { md: out, faqs };
}
function renderFaq(html, faqs) {
  if (!faqs.length) return html;
  const block = `<section class="page-faq" aria-labelledby="page-faq-h">
  <h2 id="page-faq-h">Common questions</h2>
  ${faqs.map((f) => `<div class="page-faq-item"><h3>${esc(f.q)}</h3><p>${marked.parseInline(f.a)}</p></div>`).join('\n  ')}
</section>`;
  return html.replace(/<p>\{\{FAQ_BLOCK\}\}<\/p>|\{\{FAQ_BLOCK\}\}/, block);
}
const plain = (mdText) => mdText.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`]/g, '');

// Free tools: a working calculator dropped into a content page with
// {{tool:name}}. These are the only content pages that carry script — plain
// JS, no dependencies, and the page still reads sensibly if it never runs.
const TOOLS = {
  'hourly-rate': `<section class="tool-calc" id="rate-calc" aria-labelledby="rate-calc-h">
  <h2 id="rate-calc-h" class="tool-calc-h">Your numbers</h2>
  <p class="tool-calc-note">The starting figures are placeholders, not advice. Replace every one with your own.</p>
  <div class="tool-grid">
    <label for="rc-pay">Pay you want per year<span>Before your personal income tax</span><input id="rc-pay" type="text" inputmode="numeric" autocomplete="off" data-money value="70,000"></label>
    <label for="rc-costs">Business costs per year<span>Vehicle, insurance, tools, phone, software</span><input id="rc-costs" type="text" inputmode="numeric" autocomplete="off" data-money value="18,000"></label>
    <label for="rc-weeks">Weeks worked per year<span>52 minus holidays, sick days, slow weeks</span><input id="rc-weeks" type="number" inputmode="decimal" min="1" max="52" step="1" value="46"></label>
    <label for="rc-hours">Hours worked per week<span>All of them, not just on the tools</span><input id="rc-hours" type="number" inputmode="decimal" min="1" max="100" step="1" value="45"></label>
    <label for="rc-billable">Share of hours you can bill (%)<span>Driving, quoting and paperwork are not billable</span><input id="rc-billable" type="number" inputmode="decimal" min="5" max="100" step="5" value="60"></label>
    <label for="rc-margin">Profit margin (%)<span>What the business keeps after paying you</span><input id="rc-margin" type="number" inputmode="decimal" min="0" max="90" step="1" value="10"></label>
  </div>
  <div class="tool-result" aria-live="polite">
    <div><div class="k" id="rc-rate">—</div><div class="l">per billable hour</div></div>
    <div><div class="k" id="rc-day">—</div><div class="l">for a full day on site</div></div>
    <div><div class="k" id="rc-month">—</div><div class="l">to bill each month</div></div>
  </div>
  <p class="tool-calc-note" id="rc-explain"></p>
</section>
<script>
(function () {
  var ids = ['pay', 'costs', 'weeks', 'hours', 'billable', 'margin'];
  var el = function (id) { return document.getElementById('rc-' + id); };
  var money = function (n) { return '$' + Math.round(n).toLocaleString('en-US'); };
  function calc() {
    var v = {};
    ids.forEach(function (k) { v[k] = parseFloat(String(el(k).value).replace(/,/g, '')) || 0; });
    var billableHours = v.weeks * v.hours * (v.billable / 100);
    var margin = Math.min(Math.max(v.margin, 0), 90) / 100;
    if (billableHours <= 0) { ['rate', 'day', 'month'].forEach(function (k) { el(k).textContent = '—'; }); el('explain').textContent = ''; return; }
    var revenue = (v.pay + v.costs) / (1 - margin);
    var rate = revenue / billableHours;
    el('rate').textContent = money(rate);
    el('day').textContent = money(rate * 8);
    el('month').textContent = money(revenue / 12);
    el('explain').textContent = 'That is ' + Math.round(billableHours).toLocaleString('en-US') + ' billable hours a year, out of ' + Math.round(v.weeks * v.hours).toLocaleString('en-US') + ' worked, and ' + money(revenue) + ' a year through the business.';
  }
  // Dollar fields read 70,000, not 70000. They are text inputs for that reason
  // (a number input cannot hold a comma), reformatted as you type with the
  // caret kept after the same digit it was after.
  var group = function (digits) { return digits.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ','); };
  function formatMoney(input) {
    var caret = input.selectionStart == null ? input.value.length : input.selectionStart;
    var digitsBefore = input.value.slice(0, caret).replace(/\\D/g, '').length;
    var digits = input.value.replace(/\\D/g, '').replace(/^0+(?=\\d)/, '').slice(0, 9);
    input.value = group(digits);
    var pos = 0, seen = 0;
    while (pos < input.value.length && seen < digitsBefore) { if (/\\d/.test(input.value[pos])) seen++; pos++; }
    try { input.setSelectionRange(pos, pos); } catch (e) { /* not focused */ }
  }
  ids.forEach(function (k) {
    el(k).addEventListener('input', function () { if (el(k).hasAttribute('data-money')) formatMoney(el(k)); calc(); });
  });
  calc();
})();
</script>`,
};
function expandTools(html, file) {
  return html.replace(/<p>\{\{tool:([a-z-]+)\}\}<\/p>|\{\{tool:([a-z-]+)\}\}/g, (_m, a, b) => {
    const name = a || b;
    if (!TOOLS[name]) fail(`${file}: unknown tool "${name}" (have: ${Object.keys(TOOLS).join(', ')})`);
    return TOOLS[name];
  });
}

// {{mock:name}} → the markup above, with an optional caption line beneath:
// {{mock:route|Your route for the day, in order.}}
function expandMocks(html, file, company) {
  return html.replace(/\{\{mock:([a-z]+)(?:\|([^}]*))?\}\}/g, (_m, name, caption) => {
    if (!MOCKS[name]) fail(`${file}: unknown mock "${name}" (have: ${Object.keys(MOCKS).join(', ')})`);
    // Runs after marked.parse, so the caption is already HTML-escaped —
    // escaping again would turn a typographic apostrophe into &amp;#39;.
    return `<div class="page-mock">${MOCKS[name](company)}</div>` + (caption ? `\n<div class="cm-figcap">${caption.trim()}</div>` : '');
  });
}
const routeToFile = (p) => p.replace(/^\//, '').replace(/\//g, '__') + '.html';

// `hero` (index pages only) swaps the article header for a centered hero in
// the marketing page's key: spaced/underlined eyebrow, oversized serif
// headline with an italic accent, and a lede. headlineHtml is authored here,
// so it may contain <em>.
function pageTemplate({ title, description, pagePath, eyebrow, date, bodyHtml, hero, photo, photoAlt, photoCredit, faqs = [], kind = 'article', crumbs = [], related = '' }) {
  const canonical = BASE_URL + pagePath;
  const dateLine = date
    ? `<div class="page-date">Updated ${new Date(date + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>`
    : '';
  const headerHtml = hero
    ? `<header class="page-hero">
      ${eyebrow ? `<div class="ed-eyebrow">${esc(eyebrow)}</div>` : ''}
      <h1 class="ed-hero-headline">${hero.headlineHtml}</h1>
      ${hero.lede ? `<p class="ed-hero-lede">${esc(hero.lede)}</p>` : ''}
    </header>`
    : `<header class="page-head">
      ${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}
      <h1>${esc(title)}</h1>
    </header>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)} — Field Manager</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${canonical}" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <meta name="theme-color" content="#f7f4ec" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:site_name" content="Field Manager" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:image" content="${photo ? unsplash(photo, 1200) : `${BASE_URL}/og-image.png`}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${photo ? unsplash(photo, 1200) : `${BASE_URL}/og-image.png`}" />
  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${BASE_URL}/#org`, name: 'Field Manager', url: BASE_URL, logo: `${BASE_URL}/og-image.png` },
      // The product, with its real prices. {{price_num}} is filled per request
      // from the same source as the visible price, so a running offer is
      // reflected here too.
      {
        '@type': 'SoftwareApplication', '@id': `${BASE_URL}/#app`, name: 'Field Manager', url: BASE_URL,
        applicationCategory: 'BusinessApplication', operatingSystem: 'Web, iOS, Android',
        description: 'Scheduling, customer records, quotes and invoicing for small service businesses. One flat monthly price with unlimited users.',
        publisher: { '@id': `${BASE_URL}/#org` },
        offers: [
          { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD', description: 'Up to 5 customers and 20 jobs in total, no time limit. Invoicing, reports and team members are part of Pro.' },
          { '@type': 'Offer', name: 'Pro', price: '{{price_num}}', priceCurrency: 'USD', description: 'Per month, flat. Every feature. Unlimited customers, jobs and users.' },
        ],
      },
      kind === 'tool'
        ? { '@type': 'WebApplication', name: title, url: canonical, description, applicationCategory: 'BusinessApplication', operatingSystem: 'Any', isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, publisher: { '@id': `${BASE_URL}/#org` } }
        : {
          '@type': kind === 'index' ? 'CollectionPage' : 'Article', headline: title, description, url: canonical,
          mainEntityOfPage: canonical, image: photo ? unsplash(photo, 1200) : `${BASE_URL}/og-image.png`,
          ...(date ? { datePublished: date, dateModified: date } : {}),
          author: { '@id': `${BASE_URL}/#org` }, publisher: { '@id': `${BASE_URL}/#org` },
          about: { '@id': `${BASE_URL}/#app` },
        },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [{ name: 'Field Manager', url: BASE_URL + '/' }, ...crumbs, { name: title, url: canonical }]
          .map((c, n) => ({ '@type': 'ListItem', position: n + 1, name: c.name, item: c.url })),
      },
      ...(faqs.length ? [{
        '@type': 'FAQPage',
        mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: plain(f.a) } })),
      }] : []),
    ],
  })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap">
  <style>
    :root {
      --bg: #f7f4ec; --card: #ffffff; --text: #19170f; --text-muted: #66635c;
      --border: #e8e1d1; --border-strong: #d4cab4; --tinted: #efe7d3;
      --primary: #2c3e57; --primary-hover: #1b2940; --danger: #a23b2c;
      /* Navy, as on the landing page: the marketing site has one accent. */
      --accent: #2c3e57; --serif: 'Fraunces', Georgia, 'Times New Roman', serif;
    }
    * { box-sizing: border-box; margin: 0; }
    body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; line-height: 1.65; }
    /* Header + footer mirror the marketing landing page (.ed-nav /
       .landing-footer in public/index.html) — same 1240px width so the site
       chrome is identical, while the article column below stays at 760px. */
    .ed-nav {
      max-width: 1240px; margin: 0 auto;
      padding: 28px 32px;
      display: flex; align-items: center; justify-content: space-between;
      padding-top: max(28px, env(safe-area-inset-top));
    }
    .ed-brand {
      display: inline-flex; align-items: center; gap: 9px;
      font-family: var(--serif); font-weight: 600;
      font-size: 20px; letter-spacing: -0.01em;
      color: var(--text); text-decoration: none;
    }
    .ed-brand-icon { width: 26px; height: 26px; display: block; flex-shrink: 0; }
    .ed-nav-actions { display: flex; align-items: center; gap: 18px; }
    .ed-nav-link {
      font-size: 14px; color: var(--text-muted);
      text-decoration: none; padding: 6px 4px;
    }
    .ed-nav-link:hover { color: var(--text); }
    .ed-nav-cta {
      background: var(--primary); color: #fff;
      border-radius: 999px; text-decoration: none;
      padding: 9px 18px; font-size: 13px; font-weight: 600;
      transition: transform 0.2s ease, opacity 0.2s ease;
    }
    .ed-nav-cta:hover { transform: translateY(-1px); opacity: 0.92; }
    @media (max-width: 600px) {
      .ed-nav { padding: 20px 20px; }
      .ed-nav-actions { gap: 12px; }
      .ed-nav-learn { display: none; }
    }
    main { max-width: 760px; margin: 0 auto; padding: 24px 20px 60px; }
    /* Prose column matches the marketing page's measure (~17px over a narrow
       column) rather than running the full container width. */
    article { max-width: 620px; margin-left: auto; margin-right: auto; }
    main.has-hero > article { max-width: 620px; margin: 0 auto; }
    /* Article header is centred like the marketing hero; the prose below
       stays left-aligned for reading. */
    .page-head { text-align: center; margin-bottom: 36px; }
    .eyebrow {
      display: inline-block;
      font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.22em;
      color: var(--text-muted); margin-bottom: 28px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }
    .page-head h1 { margin-left: auto; margin-right: auto; max-width: 20ch; }
    /* Index-page hero, in the marketing hero's key (.ed-hero* in index.html). */
    main.has-hero { max-width: 980px; padding-top: 40px; }
    .page-hero { text-align: center; margin-bottom: 56px; }
    .ed-eyebrow {
      display: inline-block;
      font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.22em;
      color: var(--text-muted); margin-bottom: 28px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }
    .ed-hero-headline {
      font-family: var(--serif); font-weight: 500;
      font-size: clamp(36px, 5.2vw, 60px);
      line-height: 1.04; letter-spacing: -0.035em;
      margin: 0 0 24px; color: var(--text);
    }
    .ed-hero-headline em {
      font-style: italic; font-weight: 500;
      color: var(--accent);
    }
    .ed-hero-lede {
      font-size: 18px; line-height: 1.6;
      color: var(--text-muted); margin: 0 auto;
      max-width: 560px;
    }
    h1 {
      font-family: var(--serif); font-weight: 500;
      font-size: clamp(36px, 5.2vw, 56px);
      line-height: 1.06; letter-spacing: -0.03em;
      margin-bottom: 10px;
    }
    .page-date { color: var(--text-muted); font-size: 13px; margin-bottom: 28px; }
    article h2 { font-family: var(--serif); font-weight: 600; font-size: 26px; margin: 38px 0 12px; }
    article h3 { font-size: 18px; font-weight: 700; margin: 26px 0 8px; }
    article p, article li { font-size: 17px; line-height: 1.7; color: #33302a; }
    /* Standfirst: the opening paragraph, centred and set a little larger,
       then normal reading measure resumes. */
    article > p.standfirst {
      text-align: center; font-size: 19px; line-height: 1.6;
      color: var(--text-muted); max-width: 620px;
      margin: 0 auto 28px;
    }
    /* Without a photo to close the opening, a rule does it — at the same
       width the photo and feature blocks use, so openings line up sitewide. */
    main:not(.has-photo) article > p.standfirst {
      width: 100%; max-width: 620px;
      padding-bottom: 44px; margin: 0 auto 44px;
      border-bottom: 1px solid var(--border);
    }
    @media (min-width: 1000px) {
      main:not(.has-photo) article > p.standfirst {
        width: 880px; max-width: none;
        margin-left: 50%; transform: translateX(-50%);
      }
    }
    /* Sections read as bands, echoing the feature blocks. */
    article h2 {
      border-top: 1px solid var(--border);
      padding-top: 44px; margin-top: 52px;
    }
    /* …except where a rule already sits immediately above. */
    article > p.standfirst + h2,
    .page-chapter + h2,
    article > h2:first-child { border-top: none; padding-top: 0; margin-top: 38px; }
    /* Section banding is for the article's own sections — a block's title is
       inside a bordered band already and must not draw its own rule. */
    .page-chapter h2.ed-chapter-title {
      border-top: none; padding-top: 0; margin-top: 0;
    }
    /* Key point — authored as a markdown blockquote. */
    article blockquote {
      margin: 30px 0; padding: 4px 0 4px 22px;
      border-left: 3px solid var(--accent);
      font-family: var(--serif); font-weight: 500;
      font-size: 21px; line-height: 1.45; letter-spacing: -0.01em;
      color: var(--text);
    }
    article blockquote p { font-size: inherit; line-height: inherit; color: inherit; margin: 0; }
    article p { margin: 0 0 16px; }
    article ul, article ol { margin: 0 0 16px; padding-left: 24px; }
    article li { margin-bottom: 8px; }
    article a { color: var(--primary); }
    article strong { color: var(--text); }
    .table-wrap { overflow-x: auto; margin: 20px 0; }
    article table { border-collapse: collapse; width: 100%; background: var(--card); border: 1px solid var(--border); border-radius: 10px; font-size: 14px; }
    article th, article td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--border); vertical-align: top; }
    article th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
    article tr:last-child td { border-bottom: none; }
    /* Trade photography. Served from Unsplash's CDN with sizing params, per
       their guidance — no binaries in the repo. */
    .page-photo {
      /* Matches the prose column until the breakout kicks in, so the photo
         and the feature blocks always share an edge. */
      width: 100%; max-width: 620px;
      margin: 0 auto 44px; border-radius: 14px; overflow: hidden;
      border: 1px solid var(--border);
      box-shadow: 0 18px 44px -28px rgba(40,30,20,0.45);
      background: var(--tinted);
    }
    .page-photo img {
      display: block; width: 100%; height: clamp(200px, 34vw, 320px);
      object-fit: cover;
    }
    article figure { margin: 28px 0; }
    article figure img {
      display: block; width: 100%; border-radius: 12px;
      border: 1px solid var(--border);
    }
    article figcaption {
      font-size: 13px; color: var(--text-muted);
      margin-top: 10px; text-align: center;
    }
    .photo-credit {
      font-size: 11px; color: var(--text-muted); text-align: right;
      margin: -30px 0 34px; opacity: 0.8;
    }
    .photo-credit a { color: inherit; }

    /* UI mockups, in the same key as the landing page's chapter mocks — drawn
       in CSS rather than screenshotted, so they stay sharp, weigh nothing, and
       can never leak real customer data. */
    /* Feature rows: prose left, mock right — the landing page's .ed-chapter.
       Breaks out of the 760px article column so the two columns get the same
       room they do on the marketing page. */
    .page-chapter {
      /* Full column width by default; only breaks out of the prose column
         when the viewport can actually accommodate it (see media query
         below) — otherwise the negative offset pushes content off-screen. */
      width: 100%;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 340px);
      justify-content: center;
      gap: 48px;
      /* Outer spacing matches the inner padding so the band breathes evenly. */
      padding: 52px 0; margin: 52px 0;
      align-items: center;
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
    }
    /* Consecutive blocks read as one banded run — they butt together and
       share a single divider, the way the landing page's chapters do. */
    .page-chapter + .page-chapter { border-top: none; margin-top: 0; }
    /* …and the preceding one drops its trailing gap. Degrades to a normal
       gap where :has() is unsupported, which still reads fine. */
    .page-chapter:has(+ .page-chapter) { margin-bottom: 0; }
    .ed-chapter-body-col { max-width: 460px; }
    .ed-chapter-mock { display: flex; justify-content: center; }
    .ed-chapter-title {
      font-family: var(--serif); font-weight: 500;
      font-size: clamp(26px, 3.2vw, 36px);
      line-height: 1.1; letter-spacing: -0.025em;
      margin: 0 0 16px; color: var(--text);
    }
    .ed-chapter-prose p {
      font-size: 17px; line-height: 1.65;
      color: var(--text-muted); margin: 0 0 12px;
    }
    .ed-chapter-prose p:last-child { margin-bottom: 0; }
    .ed-chapter-prose em { font-style: italic; color: var(--text); }
    /* Alternate sides so a run of chapters does not read as one long column. */
    @media (min-width: 781px) {
      .page-chapter--flip { grid-template-columns: minmax(0, 340px) minmax(0, 1fr); }
      .page-chapter--flip .ed-chapter-body-col { order: 2; }
    }
    /* Two columns only when both fit; below that, stack — words first, and
       centred over the phone rather than left-aligned above a centred one. */
    @media (max-width: 780px) {
      .page-chapter {
        grid-template-columns: 1fr; gap: 32px; padding: 44px 0; margin: 44px 0;
        align-items: start;
      }
      .ed-chapter-body-col { max-width: 540px; margin: 0 auto; text-align: center; }
      .ed-chapter-title { text-wrap: balance; }
    }
    /* Break out of the prose column once there's room on both sides. */
    @media (min-width: 1000px) {
      .page-chapter, .page-photo {
        width: 880px; max-width: none;
        margin-left: 50%; transform: translateX(-50%);
      }
      .page-photo { margin-bottom: 44px; }
    }
    ${PHONE_CSS}
    .pd-phone { --pd-w: 270; }
    .page-mock { display: flex; justify-content: center; margin: 32px 0; }
    @media (max-width: 780px) { .pd-phone { --pd-w: 256; } }
    /* The app's icon set, as far as the phone's tab bar needs it. */
    .icon { display: inline-block; width: 1em; height: 1em; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; fill: none; }
    .icon-glyph text { fill: currentColor; stroke: none; font: 600 20px 'Inter', sans-serif; }
    .cm-figcap {
      font-size: 13px; color: var(--text-muted);
      text-align: center; margin: -14px 0 30px;
    }
    /* Free tools. A form, so: real labels, big tap targets, numbers that line up. */
    .tool-calc {
      background: var(--card); border: 1px solid var(--border); border-radius: 16px;
      padding: 28px; margin: 8px 0 44px; box-shadow: 0 18px 44px -32px rgba(40,30,20,0.4);
    }
    article h2.tool-calc-h { border-top: 0; padding-top: 0; margin: 0 0 4px; font-size: 22px; }
    .tool-calc-note { font-size: 14px !important; color: var(--text-muted) !important; margin: 0 0 18px !important; }
    .tool-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 18px; }
    .tool-grid label { display: flex; flex-direction: column; font-size: 14.5px; font-weight: 600; color: var(--text); }
    .tool-grid label span { font-size: 12.5px; font-weight: 400; color: var(--text-muted); margin: 2px 0 7px; }
    .tool-grid input {
      font: 500 17px/1.2 'Inter', sans-serif; font-variant-numeric: tabular-nums; color: var(--text);
      padding: 12px 13px; border: 1px solid var(--border-strong); border-radius: 10px; background: #fff; width: 100%; margin-top: auto;
    }
    .tool-grid input:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .tool-result { display: grid; grid-template-columns: repeat(3, 1fr); margin: 24px 0 14px; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
    .tool-result > div { padding: 18px 12px; text-align: center; border-left: 1px solid var(--border); }
    .tool-result > div:first-child { border-left: 0; background: var(--primary); color: #fff; }
    .tool-result .k { font-family: var(--serif); font-weight: 600; font-size: clamp(24px, 4vw, 32px); letter-spacing: -0.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .tool-result .l { margin-top: 6px; font-size: 12.5px; color: var(--text-muted); }
    .tool-result > div:first-child .l { color: rgba(255,255,255,0.78); }
    @media (max-width: 600px) {
      .tool-calc { padding: 20px 16px; }
      .tool-grid { grid-template-columns: 1fr; }
      .tool-result { grid-template-columns: 1fr; }
      .tool-result > div { border-left: 0; border-top: 1px solid var(--border); display: flex; align-items: baseline; justify-content: space-between; text-align: left; padding: 14px 16px; }
      .tool-result > div:first-child { border-top: 0; }
      .tool-result .l { margin-top: 0; order: -1; }
    }
    @media (min-width: 1000px) {
      .tool-calc { width: 760px; margin-left: 50%; transform: translateX(-50%); }
    }
    /* Questions people actually type. Plain visible text: what a crawler or an
       assistant reads is what a person reads. */
    .page-faq { margin-top: 52px; padding-top: 44px; border-top: 1px solid var(--border); }
    article .page-faq h2 { border-top: 0; padding-top: 0; margin-top: 0; }
    .page-faq-item { padding: 16px 0; border-bottom: 1px solid var(--border); }
    .page-faq-item:last-child { border-bottom: 0; }
    article .page-faq-item h3 { margin: 0 0 6px; font-size: 17px; font-weight: 600; }
    article .page-faq-item p { margin: 0; font-size: 16px; color: #33302a; }
    .page-related { margin-top: 44px; padding-top: 28px; border-top: 1px solid var(--border); font-size: 15px; color: var(--text-muted); }
    .page-related strong { display: block; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 8px; color: var(--text-muted); }
    .page-related a { color: var(--primary); white-space: nowrap; }
    /* The closing band: the landing page's two matched pills. */
    .page-final {
      margin: 56px 0 0; padding: 48px 0 8px; text-align: center;
      border-top: 1px solid var(--border);
    }
    .page-final p {
      font-family: var(--serif); font-weight: 500; font-size: clamp(22px, 3vw, 28px);
      line-height: 1.2; letter-spacing: -0.02em; color: var(--text);
      margin: 0 auto 24px; max-width: 24ch; text-wrap: balance;
    }
    .page-final-actions { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; align-items: stretch; }
    .page-final-actions a {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 17px 28px; border-radius: 999px; border: 1px solid var(--primary);
      font-size: 17px; font-weight: 600; line-height: 1.25; text-decoration: none;
      background: var(--primary); color: #fff;
      transition: transform 0.2s ease, opacity 0.2s ease;
    }
    .page-final-actions a + a { background: #fff; color: var(--text); border-color: var(--border); }
    .page-final-actions a:hover { transform: translateY(-1px); opacity: 0.94; }
    @media (max-width: 600px) { .page-final-actions a { flex: 1 1 100%; } }
    @media (min-width: 1000px) {
      .page-final { width: 880px; margin-left: 50%; transform: translateX(-50%); }
    }

    .page-list { list-style: none; padding: 0; }
    .page-list li { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 18px 22px; margin-bottom: 12px; }
    .page-list a { font-family: var(--serif); font-weight: 600; font-size: 20px; color: var(--text); text-decoration: none; }
    .page-list a:hover { color: var(--primary); }
    .page-list p { margin: 6px 0 0; color: var(--text-muted); font-size: 14px; }
    .landing-footer {
      padding: 40px; text-align: center; color: var(--text-muted); font-size: 13px;
      border-top: 1px solid var(--border); margin-top: 40px;
    }
    /* No margin on the links themselves — the "·" separators carry the
       spacing, matching the marketing footer exactly. */
    .landing-footer a, .landing-footer .link-button {
      color: var(--text-muted); text-decoration: none;
    }
    .landing-footer a:hover, .landing-footer .link-button:hover { color: var(--text); text-decoration: underline; }
    .landing-footer .sep { margin: 0 12px; }
    .link-button {
      background: none; border: none; padding: 0; cursor: pointer;
      font: inherit; color: inherit;
    }
    /* Revealed by the consent manager only when trackers are configured. */
    #fm-cookie-settings { display: none; }
  </style>
  %TRACKING_SCRIPTS%
</head>
<body>
  <nav class="ed-nav">
    <a class="ed-brand" href="/"><img src="/favicon.svg" alt="" class="ed-brand-icon" />Field Manager</a>
    <div class="ed-nav-actions">
      <a class="ed-nav-link ed-nav-learn" href="/pricing">Pricing</a>
      <a class="ed-nav-link" href="/signin">Sign in</a>
      <a class="ed-nav-cta" href="/signup">Start free</a>
    </div>
  </nav>
  <main class="${hero ? 'has-hero' : ''}${photo ? ' has-photo' : ''}">
    ${headerHtml}
    ${photo ? `<div class="page-photo"><img src="${unsplash(photo)}" alt="${esc(photoAlt || '')}" width="1400" height="640" loading="eager"></div>
    ${photoCredit ? `<div class="photo-credit">Photo: ${esc(photoCredit)} / <a href="https://unsplash.com" rel="noopener">Unsplash</a></div>` : ''}` : ''}
    <article>
${bodyHtml}
${related}
    </article>
  </main>
  <footer class="landing-footer">
    <div>
      <a href="/pricing">Pricing</a>
      <span class="sep">·</span>
      <a href="/about">About</a>
      <span class="sep">·</span>
      <a href="/use-cases">Use cases</a>
      <span class="sep">·</span>
      <a href="/learn">Learn</a>
      <span class="sep">·</span>
      <a href="/tools/hourly-rate">Rate calculator</a>
      <span class="sep">·</span>
      <a href="/contact">Contact</a>
      <span class="sep">·</span>
      <a href="/terms">Terms</a>
      <span class="sep">·</span>
      <a href="/privacy">Privacy</a>
      <span id="fm-cookie-settings"><span class="sep">·</span><button type="button" class="link-button" onclick="window.fmOpenConsent && window.fmOpenConsent()">Cookie settings</button></span>
    </div>
    <div style="margin-top: 16px">© Field Manager</div>
  </footer>
  <script>
    // The consent manager defines window.fmOpenConsent only when analytics or
    // advertising trackers are actually configured — so the link stays hidden
    // when there is nothing to manage, matching the SPA's CookieSettingsLink.
    if (typeof window.fmOpenConsent === 'function') {
      document.getElementById('fm-cookie-settings').style.display = 'inline';
    }
  </script>
</body>
</html>`;
}

// ---- build ----
if (!fs.existsSync(CONTENT_DIR)) fail('content/ directory not found');
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const f of fs.readdirSync(OUT_DIR)) fs.unlinkSync(path.join(OUT_DIR, f));

marked.setOptions({ gfm: true });

const pages = [];
for (const file of fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md')).sort()) {
  const raw = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8');
  const { meta, body } = parseFrontmatter(raw, file);
  const { md: md0, faqs } = extractFaq(body, file);
  const { md, chapters } = extractChapters(md0, file);
  let bodyHtml = marked.parse(md);
  // The business named on the phones. A use-case page sets its own trade's.
  const company = meta.demo_name || 'Acme Lawn & Landscape';
  bodyHtml = renderChapters(bodyHtml, chapters, company);
  // First paragraph acts as the standfirst under the photo.
  bodyHtml = bodyHtml.replace('<p>', '<p class="standfirst">', 1);
  // Horizontal scroll for wide tables on phones.
  bodyHtml = bodyHtml.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
  // marked wraps a standalone {{mock:…}} in a <p>; unwrap so the frame isn't
  // nested in a paragraph, then expand.
  bodyHtml = bodyHtml.replace(/<p>(\{\{mock:[^}]*\}\})<\/p>/g, '$1');
  bodyHtml = expandMocks(bodyHtml, file, company);
  bodyHtml = expandTools(bodyHtml, file);
  bodyHtml = renderFaq(bodyHtml, faqs);
  // The closing line, authored as <div class="cta">Lead text <a>…</a> or
  // <a>…</a>.</div>, becomes the landing page's closing band: the lead as a
  // headline, the links as its two matched pills. The joining words go.
  bodyHtml = bodyHtml.replace(/<div class="cta">([\s\S]*?)<\/div>/g, (_m, inner) => {
    const links = inner.match(/<a [^>]*>[\s\S]*?<\/a>/g) || [];
    // A link written mid-sentence ("or <a>try the live demo</a>") is a button now.
    const cap = (l) => l.replace(/>(\s*)([a-z])/, (_x, sp, ch) => `>${sp}${ch.toUpperCase()}`);
    const lead = inner.slice(0, inner.indexOf('<a ')).trim();
    return `<section class="page-final">${lead ? `<p>${lead}</p>` : ''}<div class="page-final-actions">${links.map(cap).join('')}</div></section>`;
  });
  pages.push({ ...meta, bodyHtml, faqs });
}

// Every page links to its neighbours: the other trades, the comparisons, the
// tools. Crawlers follow links, and a reader on the wrong trade's page is one
// click from the right one.
const short = (p) => (p.eyebrow || p.title).replace(/^For /, '').replace(/^./, (c) => c.toUpperCase());
function relatedFor(page) {
  const others = (list) => list.filter((p) => p.path !== page.path)
    .map((p) => `<a href="${p.path}">${esc(p.collection === 'use-cases' ? short(p) : p.title)}</a>`).join(' · ');
  const uses = others(pages.filter((p) => p.collection === 'use-cases'));
  const learn = others(pages.filter((p) => p.path.startsWith('/learn/')));
  const tools = others(pages.filter((p) => p.path.startsWith('/tools/')));
  return `<nav class="page-related" aria-label="Related pages">
  ${uses ? `<p><strong>Field Manager for</strong>${uses}</p>` : ''}
  ${learn ? `<p><strong>Comparisons</strong>${learn}</p>` : ''}
  ${tools ? `<p><strong>Free tools</strong>${tools}</p>` : ''}
</nav>`;
}

const manifest = {};
for (const p of pages) {
  const fileName = routeToFile(p.path);
  const kind = p.path.startsWith('/tools/') ? 'tool' : 'article';
  const crumbs = p.collection === 'use-cases' ? [{ name: 'Use cases', url: BASE_URL + '/use-cases' }]
    : p.path.startsWith('/learn/') ? [{ name: 'Learn', url: BASE_URL + '/learn' }] : [];
  fs.writeFileSync(path.join(OUT_DIR, fileName), pageTemplate({
    title: p.title, description: p.description, pagePath: p.path,
    eyebrow: p.eyebrow, date: p.date, bodyHtml: p.bodyHtml,
    photo: p.photo, photoAlt: p.photo_alt, photoCredit: p.photo_credit,
    faqs: p.faqs, kind, crumbs, related: relatedFor(p),
  }));
  manifest[p.path] = `_pages/${fileName}`;
}

// /learn index: every page under /learn/, newest first.
const learnPages = pages.filter((p) => p.path.startsWith('/learn/'))
  .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
const indexBody = `<ul class="page-list">
${learnPages.map((p) => `  <li><a href="${p.path}">${esc(p.title)}</a><p>${esc(p.description)}</p></li>`).join('\n')}
</ul>`;
fs.writeFileSync(path.join(OUT_DIR, routeToFile('/learn')), pageTemplate({
  title: 'Guides & comparisons for small service businesses',
  description: 'Plain-English guides on running a small service business — scheduling, invoicing, and picking software that fits a one-person operation.',
  pagePath: '/learn', eyebrow: 'Learn', date: null, bodyHtml: indexBody, kind: 'index',
  hero: {
    headlineHtml: 'Comparisons we wrote <em>honestly</em>.',
    lede: 'Including the parts where the other tool is the better choice. Plain-English guides on picking software that fits a one-person operation.',
  },
}));
manifest['/learn'] = `_pages/${routeToFile('/learn')}`;

// /use-cases index: pages tagged `collection: use-cases` (flat URLs like
// /barbers stay as-is — this page is just the directory that lists them).
const useCasePages = pages.filter((p) => p.collection === 'use-cases')
  .sort((a, b) => a.title.localeCompare(b.title));
const useCasesBody = `<ul class="page-list">
${useCasePages.map((p) => `  <li><a href="${p.path}">${esc(p.title)}</a><p>${esc(p.description)}</p></li>`).join('\n')}
</ul>`;
fs.writeFileSync(path.join(OUT_DIR, routeToFile('/use-cases')), pageTemplate({
  title: 'Who Field Manager is for',
  description: 'How barbers, lawn care operators, and other small service businesses run on Field Manager — scheduling, booking, invoicing, and a simple website for $29/month flat.',
  pagePath: '/use-cases', eyebrow: 'Use cases', date: null, bodyHtml: useCasesBody, kind: 'index',
  hero: {
    headlineHtml: 'One flat price, <em>every trade</em>.',
    lede: 'Field Manager is one tool, but every trade runs it a little differently. These pages show what it looks like for your kind of work.',
  },
}));
manifest['/use-cases'] = `_pages/${routeToFile('/use-cases')}`;

fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

// sitemap.xml — marketing base + generated pages.
const urls = [
  { loc: '/', priority: '1.0', changefreq: 'weekly' },
  { loc: '/start', priority: '0.8', changefreq: 'monthly' },
  { loc: '/contact', priority: '0.4', changefreq: 'yearly' },
  { loc: '/terms', priority: '0.3', changefreq: 'yearly' },
  { loc: '/privacy', priority: '0.3', changefreq: 'yearly' },
  { loc: '/learn', priority: '0.7', changefreq: 'weekly' },
  ...Object.keys(manifest).filter((p) => p !== '/learn')
    .map((p) => ({ loc: p, priority: '0.7', changefreq: 'monthly', lastmod: (pages.find((x) => x.path === p) || {}).date })),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${BASE_URL}${u.loc === '/' ? '/' : u.loc}</loc>${u.lastmod ? `
    <lastmod>${u.lastmod}</lastmod>` : ''}
    <priority>${u.priority}</priority>
    <changefreq>${u.changefreq}</changefreq>
  </url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(PUBLIC_DIR, 'sitemap.xml'), sitemap);

// llms.txt — the plain-language summary AI assistants are pointed at. Built
// here so its page list can never go stale, and written to be quotable: every
// line is a fact that is true today, including what the product does NOT do.
// A recommendation that turns out wrong helps nobody.
const listPages = (list) => list.map((p) => `- [${p.title}](${BASE_URL}${p.path}): ${p.description.replace(/\{\{price\}\}/g, '$29').replace(/\{\{[a-z_]+\}\}/g, '')}`).join('\n');
fs.writeFileSync(path.join(PUBLIC_DIR, 'llms.txt'), `# Field Manager

> Field Manager (https://fieldmgr.com) is a web app for very small service businesses, one to about eight people. It keeps customers, a schedule of one-off and repeating jobs, quotes and invoices in one place, and rolls completed visits into one invoice per customer at the end of the month. One flat price, unlimited users.

## Who it is for

Owner-operators and small crews who visit customers to do the work: handymen, painters, lawn care and snow removal, house cleaners, mobile detailers, barbers, and similar. It fits best when the same customers come back, and when work is quoted, scheduled, completed and then invoiced.

## Who it is not for

- Businesses that need a dispatch board, technician GPS, route optimisation, a flat-rate price book, parts inventory, or maintenance-agreement management (larger plumbing, HVAC and electrical shops). Jobber, Housecall Pro or ServiceTitan fit those better.
- Businesses that must charge a stored card automatically after each visit. Field Manager does not store cards or run autopay.
- Anyone who needs regulated records: pesticide application logs, pool chemical logs, clinical or patient notes. It keeps none of these and is not HIPAA software.

## Pricing (US dollars)

- New accounts get 14 days of every feature. No credit card is needed to start.
- Free plan: up to 5 customers and 20 jobs in total, with no time limit. Includes repeating schedules, quotes, the booking-request page and CSV import and export. It does NOT include invoicing, reports or team members.
- Pro: $29 per month, flat. Everything, including invoicing, month-end invoice roll-up, reports and team members. Unlimited customers, jobs, invoices and users. No per-user fee and no cap on the number of jobs. Limited-time offers may lower this; the pricing section of the home page is authoritative.
- Data can be exported as CSV at any time.

## What it does

- Customers: contact details, notes that stay with the customer, full job and invoice history.
- Scheduling: one-off jobs with a start time and duration, or repeating weekly, every two weeks or monthly. Day, week, month and list views. Skip or move a single visit without changing the schedule.
- Mark complete from a phone, with an optional note. Each completion records who did it, when, and the job's price on that day.
- Invoicing: create invoices by hand, or have completed visits roll into one draft invoice per customer on a monthly or weekly schedule. Nothing is sent without the owner reviewing it. Discounts, tax, and customer credit (prepayments and deposits) are supported.
- Payments: every invoice carries a pay-now link to the owner's own Stripe, PayPal, Square or Venmo. Field Manager does not process payments and takes no cut.
- Quotes: send an estimate by email or link; the customer accepts or declines online; an accepted quote converts into a customer, a job and an invoice without retyping.
- Booking requests: a public page and QR code where new customers request work. The owner accepts or declines; it is a request, not instant slot booking.
- Referrals: each customer can have a personal booking link. When someone they refer becomes a customer, the referrer earns a percentage of completed jobs as account credit. The owner sets the percentage and the limit.
- Team: admins, leads and employees with role-based access, included at no extra cost.
- A hosted one-page website for the business is available, with services, photos and reviews.
- Wording is configurable: customers can be clients or members; jobs can be visits, appointments or sessions.
- No download: it runs in the browser and can be added to a phone's home screen.
- Free data migration: send a customer list in any form and it is loaded for you, usually the same day.

## Pages

### By trade
${listPages(pages.filter((p) => p.collection === 'use-cases').sort((a, b) => a.title.localeCompare(b.title)))}

### Comparisons and guides
${listPages(pages.filter((p) => p.path.startsWith('/learn/')))}

### Free tools
${listPages(pages.filter((p) => p.path.startsWith('/tools/')))}

### Other
- [Pricing](${BASE_URL}/pricing): both plans, what each includes, and what is never charged for.
- [About](${BASE_URL}/about): who builds and runs Field Manager, and why.
- [Home](${BASE_URL}/)
- [Live demo, no sign-up](${BASE_URL}/demo)
- [Sign up](${BASE_URL}/signup)
- [Terms](${BASE_URL}/terms) · [Privacy](${BASE_URL}/privacy)

## Company

Built and run by an owner-operator who uses it for his own lawn care business. Support is answered by a person: help is inside the app, or reply to any email from Field Manager.
`);

console.log(`[build-pages] ${pages.length} content pages + /learn index + llms.txt`);
console.log(`[build-pages] routes: ${Object.keys(manifest).join(', ')}`);
console.log('[build-pages] sitemap.xml rewritten');
