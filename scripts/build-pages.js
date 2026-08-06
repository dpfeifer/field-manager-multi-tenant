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
const routeToFile = (p) => p.replace(/^\//, '').replace(/\//g, '__') + '.html';

function pageTemplate({ title, description, pagePath, eyebrow, date, bodyHtml }) {
  const canonical = BASE_URL + pagePath;
  const dateLine = date
    ? `<div class="page-date">Updated ${new Date(date + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>`
    : '';
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
  <meta property="og:image" content="${BASE_URL}/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${BASE_URL}/og-image.png" />
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
    .eyebrow {
      font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--accent); margin-bottom: 10px;
    }
    h1 { font-family: var(--serif); font-weight: 600; font-size: clamp(30px, 5vw, 42px); line-height: 1.12; letter-spacing: -0.01em; margin-bottom: 10px; }
    .page-date { color: var(--text-muted); font-size: 13px; margin-bottom: 28px; }
    article h2 { font-family: var(--serif); font-weight: 600; font-size: 26px; margin: 38px 0 12px; }
    article h3 { font-size: 18px; font-weight: 700; margin: 26px 0 8px; }
    article p, article li { font-size: 16px; color: #33302a; }
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
      <a class="ed-nav-link ed-nav-learn" href="/use-cases">Use cases</a>
      <a class="ed-nav-link ed-nav-learn" href="/#pricing">Pricing</a>
      <a class="ed-nav-link" href="/signin">Sign in</a>
      <a class="ed-nav-cta" href="/signup">Start free</a>
    </div>
  </nav>
  <main>
    ${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}
    <h1>${esc(title)}</h1>
    ${dateLine}
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
  let bodyHtml = marked.parse(body);
  // Horizontal scroll for wide tables on phones.
  bodyHtml = bodyHtml.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
  pages.push({ ...meta, bodyHtml });
}

const manifest = {};
for (const p of pages) {
  const fileName = routeToFile(p.path);
  fs.writeFileSync(path.join(OUT_DIR, fileName), pageTemplate({
    title: p.title, description: p.description, pagePath: p.path,
    eyebrow: p.eyebrow, date: p.date, bodyHtml: p.bodyHtml,
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
}));
manifest['/learn'] = `_pages/${routeToFile('/learn')}`;

// /use-cases index: pages tagged `collection: use-cases` (flat URLs like
// /barbers stay as-is — this page is just the directory that lists them).
const useCasePages = pages.filter((p) => p.collection === 'use-cases')
  .sort((a, b) => a.title.localeCompare(b.title));
const useCasesBody = `<p>Field Manager is one flat-priced tool, but every trade runs it a little differently. These pages show what it looks like for your kind of work.</p>
<ul class="page-list">
${useCasePages.map((p) => `  <li><a href="${p.path}">${esc(p.title)}</a><p>${esc(p.description)}</p></li>`).join('\n')}
</ul>`;
fs.writeFileSync(path.join(OUT_DIR, routeToFile('/use-cases')), pageTemplate({
  title: 'Who Field Manager is for',
  description: 'How barbers, lawn care operators, and other small service businesses run on Field Manager — scheduling, booking, invoicing, and a simple website for $29/month flat.',
  pagePath: '/use-cases', eyebrow: 'Use cases', date: null, bodyHtml: useCasesBody,
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
