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
      --accent: #c98558; --serif: 'Fraunces', Georgia, serif;
    }
    * { box-sizing: border-box; margin: 0; }
    body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; line-height: 1.65; }
    .site-header {
      display: flex; justify-content: space-between; align-items: center;
      max-width: 760px; margin: 0 auto; padding: 22px 20px;
    }
    .wordmark { font-family: var(--serif); font-weight: 700; font-size: 20px; color: var(--text); text-decoration: none; }
    .header-cta {
      background: var(--primary); color: #fff; text-decoration: none;
      padding: 9px 18px; border-radius: 8px; font-size: 13px; font-weight: 600;
    }
    .header-cta:hover { background: var(--primary-hover); }
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
    .site-footer {
      max-width: 760px; margin: 0 auto; padding: 26px 20px 44px;
      border-top: 1px solid var(--border);
      color: var(--text-muted); font-size: 13px;
      display: flex; gap: 16px; flex-wrap: wrap;
    }
    .site-footer a { color: var(--text-muted); }
  </style>
</head>
<body>
  <header class="site-header">
    <a class="wordmark" href="/">Field Manager</a>
    <a class="header-cta" href="/signup">Start free</a>
  </header>
  <main>
    ${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}
    <h1>${esc(title)}</h1>
    ${dateLine}
    <article>
${bodyHtml}
    </article>
  </main>
  <footer class="site-footer">
    <a href="/">Field Manager</a>
    <a href="/learn">Learn</a>
    <a href="/contact">Contact</a>
    <a href="/terms">Terms</a>
    <a href="/privacy">Privacy</a>
    <span>© ${new Date().getFullYear()} Field Manager</span>
  </footer>
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
