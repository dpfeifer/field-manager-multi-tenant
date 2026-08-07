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

// UI mockups drawn in markup, not screenshots: nothing to keep in sync with
// the app's real data, no customer information can leak, and they stay crisp
// at any density. Authors drop {{mock:name}} on its own line in the markdown.
const MOCKS = {
  route: `<div class="cm-frame">
  <div class="cm-bar"><span>Schedule · Tuesday</span></div>
  <div class="cm-card">
    <div class="cm-card-row cm-card-done"><span>Heather Stahl</span><span class="cm-card-check">✓</span></div>
    <div class="cm-card-row cm-card-done"><span>Crowley residence</span><span class="cm-card-check">✓</span></div>
    <div class="cm-card-row"><span>Marcus Bell</span><span class="cm-card-time">10:30 AM</span></div>
    <div class="cm-card-row"><span>Dee Whitfield</span><span class="cm-card-time">11:15 AM</span></div>
    <div class="cm-card-row"><span>Riverbend HOA</span><span class="cm-card-time">1:00 PM</span></div>
  </div>
</div>`,
  invoices: `<div class="cm-frame">
  <div class="cm-bar"><span>Invoices · Drafts</span></div>
  <div class="cm-list">
    <div class="cm-list-row"><div><strong>#1041</strong> · Heather Stahl</div><div class="cm-amt">$220</div></div>
    <div class="cm-list-row"><div><strong>#1042</strong> · Marcus Bell</div><div class="cm-amt">$130</div></div>
    <div class="cm-list-row"><div><strong>#1043</strong> · Dee Whitfield</div><div class="cm-amt">$260</div></div>
  </div>
  <div class="cm-cta">Review &amp; send all</div>
</div>`,
  booking: `<div class="cm-frame">
  <div class="cm-bar"><span>Request an appointment</span></div>
  <div class="cm-list">
    <div class="cm-list-row"><div>Name</div><div>Marcus Bell</div></div>
    <div class="cm-list-row"><div>Service</div><div>Full cut + beard</div></div>
    <div class="cm-list-row"><div>Preferred</div><div>Thu, 4:00 PM</div></div>
  </div>
  <div class="cm-cta">Send request</div>
</div>`,
  client: `<div class="cm-frame">
  <div class="cm-bar"><span>Client · Marcus Bell</span></div>
  <div class="cm-card">
    <div class="cm-card-row"><span>Full cut + beard</span><span class="cm-card-time">Jul 18 · $45</span></div>
    <div class="cm-card-row"><span>Full cut</span><span class="cm-card-time">Jun 27 · $35</span></div>
    <div class="cm-card-row"><span>Full cut + beard</span><span class="cm-card-time">Jun 6 · $45</span></div>
    <div class="cm-card-row"><span>Notes</span><span class="cm-card-time">#2 sides, tight</span></div>
  </div>
</div>`,
  quote: `<div class="cm-frame">
  <div class="cm-bar"><span>Quote #308 · Accepted</span></div>
  <div class="cm-list">
    <div class="cm-list-row"><div>Labor · 6 hrs</div><div class="cm-amt">$390</div></div>
    <div class="cm-list-row"><div>Materials</div><div class="cm-amt">$145</div></div>
    <div class="cm-list-row"><div><strong>Total</strong></div><div class="cm-amt">$535</div></div>
  </div>
  <div class="cm-cta">Convert to job → invoice</div>
</div>`,
};

// Feature rows. Authored as a block in the markdown, parsed BEFORE marked so
// the prose still renders as markdown:
//
//   {{chapter:route}}
//   Kicker line
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
    const kicker = (lines.shift() || '').trim();
    const title = (lines.shift() || '').trim();
    const prose = lines.join('\n').trim();
    if (!kicker || !title) fail(`${file}: chapter needs a kicker line and a title line`);
    chapters.push({ mock, kicker, title, prose });
    return `\n\n{{CHAPTER_${chapters.length - 1}}}\n\n`;
  });
  return { md: out, chapters };
}

function renderChapters(html, chapters) {
  return html.replace(/<p>\{\{CHAPTER_(\d+)\}\}<\/p>|\{\{CHAPTER_(\d+)\}\}/g, (_m, a, b) => {
    const c = chapters[Number(a ?? b)];
    return `<section class="page-chapter">
  <div class="ed-chapter-body-col">
    <p class="ed-chapter-kicker">${esc(c.kicker)}</p>
    <h2 class="ed-chapter-title">${esc(c.title)}</h2>
    <div class="ed-chapter-prose">${marked.parse(c.prose)}</div>
  </div>
  <div class="ed-chapter-mock">${MOCKS[c.mock]}</div>
</section>`;
  });
}

// {{mock:name}} → the markup above, with an optional caption line beneath:
// {{mock:route|Your route for the day, in order.}}
function expandMocks(html, file) {
  return html.replace(/\{\{mock:([a-z]+)(?:\|([^}]*))?\}\}/g, (_m, name, caption) => {
    if (!MOCKS[name]) fail(`${file}: unknown mock "${name}" (have: ${Object.keys(MOCKS).join(', ')})`);
    // Runs after marked.parse, so the caption is already HTML-escaped —
    // escaping again would turn a typographic apostrophe into &amp;#39;.
    return MOCKS[name] + (caption ? `\n<div class="cm-figcap">${caption.trim()}</div>` : '');
  });
}
const routeToFile = (p) => p.replace(/^\//, '').replace(/\//g, '__') + '.html';

// `hero` (index pages only) swaps the article header for a centered hero in
// the marketing page's key: spaced/underlined eyebrow, oversized serif
// headline with an italic accent, and a lede. headlineHtml is authored here,
// so it may contain <em>.
function pageTemplate({ title, description, pagePath, eyebrow, date, bodyHtml, hero, photo, photoAlt, photoCredit }) {
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
    : `${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}
    <h1>${esc(title)}</h1>
    ${dateLine}`;
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
    '@context': 'https://schema.org', '@type': 'Article',
    headline: title, description, url: canonical,
    ...(date ? { datePublished: date } : {}),
    publisher: { '@type': 'Organization', name: 'Field Manager', url: BASE_URL },
  })}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap">
  <style>
    :root {
      --bg: #f7f4ec; --card: #ffffff; --text: #19170f; --text-muted: #66635c;
      --border: #e8e1d1; --primary: #2c3e57; --primary-hover: #1b2940;
      --accent: #c98558; --serif: 'Fraunces', Georgia, 'Times New Roman', serif;
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
      background: var(--text); color: var(--bg);
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
    article { max-width: 620px; }
    main.has-hero > article { max-width: 620px; margin: 0 auto; }
    .eyebrow {
      font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--accent); margin-bottom: 10px;
    }
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
    h1 { font-family: var(--serif); font-weight: 600; font-size: clamp(30px, 5vw, 42px); line-height: 1.12; letter-spacing: -0.01em; margin-bottom: 10px; }
    .page-date { color: var(--text-muted); font-size: 13px; margin-bottom: 28px; }
    article h2 { font-family: var(--serif); font-weight: 600; font-size: 26px; margin: 38px 0 12px; }
    article h3 { font-size: 18px; font-weight: 700; margin: 26px 0 8px; }
    article p, article li { font-size: 17px; line-height: 1.7; color: #33302a; }
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
      margin: 0 0 40px; border-radius: 14px; overflow: hidden;
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
    /* Adjacent blocks share one rule rather than stacking two. */
    .page-chapter + .page-chapter { border-top: none; }
    .ed-chapter-body-col { max-width: 460px; }
    .ed-chapter-mock { display: flex; justify-content: center; }
    .ed-chapter-mock .cm-frame { margin: 0; }
    .ed-chapter-kicker {
      font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.18em;
      color: var(--text-muted); margin: 0 0 14px;
    }
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
    /* Two columns only when both fit; below that, stack. */
    @media (max-width: 780px) {
      .page-chapter {
        grid-template-columns: 1fr; gap: 28px; padding: 40px 0; margin: 40px 0;
        align-items: start;
      }
      .ed-chapter-mock { justify-content: flex-start; }
    }
    /* Break out of the prose column once there's room on both sides. */
    @media (min-width: 1000px) {
      .page-chapter {
        width: 880px;
        margin-left: 50%; transform: translateX(-50%);
      }
    }
    .cm-frame {
      width: 100%; max-width: 360px; margin: 28px auto;
      background: var(--card);
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      box-shadow: 0 14px 36px -22px rgba(40,30,20,0.25);
      overflow: hidden; font-size: 12px;
    }
    .cm-bar {
      padding: 10px 14px; background: var(--tinted);
      border-bottom: 1px solid var(--border);
      font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.12em;
      color: var(--text-muted);
    }
    /* Schedule-style rows: tight, dashed (matches .cm-card-row on the landing page). */
    .cm-card { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
    .cm-card-row {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 12px; color: var(--text);
      padding: 6px 0; border-bottom: 1px dashed var(--border);
    }
    .cm-card-row:last-child { border-bottom: none; }
    .cm-card-time { font-size: 11px; color: var(--text-muted); }
    .cm-card-done span:first-child { text-decoration: line-through; opacity: 0.6; }
    .cm-card-check {
      display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; border-radius: 50%;
      background: #2f6b46; color: #fff; font-size: 11px; font-weight: 700;
    }
    /* List-style rows: roomier, solid (matches .cm-list-row on the landing page). */
    .cm-list { padding: 6px 14px 14px; }
    .cm-list-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 0; border-bottom: 1px solid var(--border);
      font-size: 12px; color: var(--text);
    }
    .cm-list-row:last-child { border-bottom: none; }
    .cm-list-row strong { font-weight: 600; }
    .cm-amt {
      font-family: var(--serif); font-weight: 500;
      font-size: 14px; color: var(--text);
    }
    .cm-cta {
      margin: 0 14px 14px; padding: 10px 12px;
      background: var(--text); color: var(--bg);
      font-size: 12px; font-weight: 600;
      text-align: center; border-radius: 6px;
    }
    .cm-pill {
      display: inline-block; padding: 2px 9px; border-radius: 999px;
      background: var(--card); color: var(--text-muted);
      font-size: 9px; font-weight: 700; letter-spacing: 0.06em;
    }
    .cm-figcap {
      font-size: 13px; color: var(--text-muted);
      text-align: center; margin: -14px 0 30px;
    }

    .cta {
      background: var(--card); border: 1px solid var(--border); border-left: 4px solid var(--accent);
      border-radius: 12px; padding: 20px 24px; margin: 34px 0 0; font-size: 16px;
    }
    .cta a { color: var(--primary); font-weight: 600; }
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
      <a class="ed-nav-link ed-nav-learn" href="/#pricing">Pricing</a>
      <a class="ed-nav-link" href="/signin">Sign in</a>
      <a class="ed-nav-cta" href="/signup">Start free</a>
    </div>
  </nav>
  <main${hero ? ' class="has-hero"' : ''}>
    ${headerHtml}
    ${photo ? `<div class="page-photo"><img src="${unsplash(photo)}" alt="${esc(photoAlt || '')}" width="1400" height="640" loading="eager"></div>
    ${photoCredit ? `<div class="photo-credit">Photo: ${esc(photoCredit)} / <a href="https://unsplash.com" rel="noopener">Unsplash</a></div>` : ''}` : ''}
    <article>
${bodyHtml}
    </article>
  </main>
  <footer class="landing-footer">
    <div>
      <a href="/use-cases">Use cases</a>
      <span class="sep">·</span>
      <a href="/learn">Learn</a>
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
  const { md, chapters } = extractChapters(body, file);
  let bodyHtml = marked.parse(md);
  bodyHtml = renderChapters(bodyHtml, chapters);
  // Horizontal scroll for wide tables on phones.
  bodyHtml = bodyHtml.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
  // marked wraps a standalone {{mock:…}} in a <p>; unwrap so the frame isn't
  // nested in a paragraph, then expand.
  bodyHtml = bodyHtml.replace(/<p>(\{\{mock:[^}]*\}\})<\/p>/g, '$1');
  bodyHtml = expandMocks(bodyHtml, file);
  pages.push({ ...meta, bodyHtml });
}

const manifest = {};
for (const p of pages) {
  const fileName = routeToFile(p.path);
  fs.writeFileSync(path.join(OUT_DIR, fileName), pageTemplate({
    title: p.title, description: p.description, pagePath: p.path,
    eyebrow: p.eyebrow, date: p.date, bodyHtml: p.bodyHtml,
    photo: p.photo, photoAlt: p.photo_alt, photoCredit: p.photo_credit,
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
  pagePath: '/learn', eyebrow: 'Learn', date: null, bodyHtml: indexBody,
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
  pagePath: '/use-cases', eyebrow: 'Use cases', date: null, bodyHtml: useCasesBody,
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
    .map((p) => ({ loc: p, priority: '0.7', changefreq: 'monthly' })),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${BASE_URL}${u.loc === '/' ? '/' : u.loc}</loc>
    <priority>${u.priority}</priority>
    <changefreq>${u.changefreq}</changefreq>
  </url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(PUBLIC_DIR, 'sitemap.xml'), sitemap);

console.log(`[build-pages] ${pages.length} content pages + /learn index`);
console.log(`[build-pages] routes: ${Object.keys(manifest).join(', ')}`);
console.log('[build-pages] sitemap.xml rewritten');
