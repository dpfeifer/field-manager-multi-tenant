#!/usr/bin/env node
/**
 * Precompile the SPA's JSX at build time instead of in the browser.
 *
 * public/index.html stays the single source you edit — inline
 * <script type="text/babel"> and all. This reads it and emits:
 *
 *   public/app.<hash>.js    the compiled JSX
 *   public/index.built.html the same page, minus @babel/standalone (~2.8MB),
 *                           pointing at the compiled file
 *
 * The server prefers index.built.html and falls back to index.html, so a
 * missing or stale build degrades to the old in-browser path rather than
 * breaking the app.
 *
 * The React preset MUST use the classic runtime: the automatic runtime emits
 * ESM imports of react/jsx-runtime, which this no-bundler page cannot resolve
 * and which blanks the screen. This mirrors the data-presets="react-classic"
 * the browser build uses.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const babel = require('@babel/core');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SRC = path.join(PUBLIC_DIR, 'index.html');
const OUT_HTML = path.join(PUBLIC_DIR, 'index.built.html');

// Matches the inline JSX block and captures its contents.
const JSX_BLOCK = /<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/;
// The @babel/standalone tag, which the compiled page no longer needs.
const BABEL_TAG = /^[ \t]*<script[^>]*@babel\/standalone[^>]*><\/script>[ \t]*\r?\n?/m;
// The inline script that configures Babel's classic runtime. It only makes
// sense alongside the standalone build, and stripping the tag without this
// left it calling into a global that is no longer there — an uncaught
// ReferenceError on every page load of the built site.
// Tempered so it cannot cross a </script>: without that, the match started at
// an earlier <script> and swallowed React, ReactDOM and occurrences.js along
// with it, which blanked the built page.
const BABEL_CONFIG =
  /[ \t]*<script>(?:(?!<\/script>)[\s\S])*?Babel\.registerPreset(?:(?!<\/script>)[\s\S])*?<\/script>[ \t]*\r?\n?/;

function fail(msg) {
  console.error(`[build-client] ${msg}`);
  process.exit(1);
}

const html = fs.readFileSync(SRC, 'utf8');

const match = html.match(JSX_BLOCK);
if (!match) fail('No <script type="text/babel"> block found in public/index.html');
const jsx = match[1];

// The block is delimited by the first closing script tag, so a literal one
// written anywhere inside the JSX — in a string, or even in a comment — ends
// the extraction early. The remainder still tends to parse, so Babel succeeds
// and we ship a silently truncated bundle with half the app missing.
//
// The mount call is the last statement in the real block, so its absence means
// the extraction stopped short. Write the tag as <\/script> to avoid this.
if (!/ReactDOM\s*\.\s*createRoot/.test(jsx)) {
  fail(
    'Extracted JSX is missing the ReactDOM.createRoot mount call, so the\n'
    + '       <script type="text/babel"> block was cut short. Something inside it\n'
    + '       contains a literal closing script tag — escape it as <\\/script>.'
  );
}

if (!BABEL_TAG.test(html)) {
  console.warn('[build-client] warning: no @babel/standalone tag found — nothing to strip');
}

const { code } = babel.transformSync(jsx, {
  presets: [[require('@babel/preset-react'), { runtime: 'classic' }]],
  compact: false,
  comments: false,
  babelrc: false,
  configFile: false,
  filename: 'index.html.jsx',
});
if (!code) fail('Babel produced no output');

// Content hash lets the browser cache the bundle forever; a change to the
// source changes the URL. index.html itself is served no-cache, so the new
// URL is picked up immediately.
const hash = crypto.createHash('sha256').update(code).digest('hex').slice(0, 12);
const bundleName = `app.${hash}.js`;

// Drop any bundles from previous builds so public/ doesn't accumulate them.
for (const f of fs.readdirSync(PUBLIC_DIR)) {
  if (/^app\.[0-9a-f]{12}\.js$/.test(f) && f !== bundleName) {
    fs.unlinkSync(path.join(PUBLIC_DIR, f));
  }
}

fs.writeFileSync(path.join(PUBLIC_DIR, bundleName), code);

const builtHtml = html
  .replace(BABEL_TAG, '')
  .replace(BABEL_CONFIG, '')
  .replace(JSX_BLOCK, `<script src="/${bundleName}" defer></script>`);

if (builtHtml.includes('text/babel')) fail('JSX block was not replaced');
if (builtHtml.includes('@babel/standalone')) fail('Babel standalone tag was not stripped');
if (builtHtml.includes('Babel.registerPreset')) fail('Babel preset config was not stripped');
// A too-greedy strip takes neighbouring tags with it and the page silently
// loads nothing, so check that what the app cannot start without survived.
for (const required of ['react.production.min.js', 'react-dom.production.min.js', '/shared/occurrences.js']) {
  if (!builtHtml.includes(required)) fail(`built page is missing ${required} — a strip removed too much`);
}
if (!builtHtml.includes('%TRACKING_SCRIPTS%')) {
  fail('%TRACKING_SCRIPTS% placeholder missing — the server substitutes this at request time');
}

fs.writeFileSync(OUT_HTML, builtHtml);

const kb = (n) => Math.round(n / 1024);
console.log(`[build-client] compiled ${jsx.split('\n').length} lines of JSX`);
console.log(`[build-client] ${bundleName}  ${kb(Buffer.byteLength(code))} KB`);
console.log(`[build-client] index.built.html written (dropped ~2.8MB @babel/standalone)`);
