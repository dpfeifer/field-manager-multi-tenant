/**
 * The richer marketing home page, built as a static document.
 *
 * A PROTOTYPE, served at /preview/home (noindex, not in the sitemap, no
 * trackers). The live home page is still the SPA's landing view; nothing here
 * replaces it until Dustin says so.
 *
 * The devices are borrowed from sites like meetcleo.com; the brand is ours:
 *   - a pinned, scroll-driven opening scene (dusk -> morning, phone rises in,
 *     the scene shrinks into a card). One CSS variable, --p, runs all of it.
 *   - floating glass pills for navigation
 *   - big rounded photograph cards with the words laid over them
 *   - a tabbed product section, a snap-scrolling card row, an accordion FAQ
 *   - an oversized wordmark to close
 *
 * build-pages.js calls buildHome() with its own phone mocks and phone CSS, so
 * the phones here are the same ones as everywhere else on the site.
 */

// Unsplash photographs (free licence, hotlinked like the trade pages' photos).
const PHOTOS = {
  dusk: 'photo-1791912192895-f344479b1380',     // rooftops and trees before sunrise
  morning: 'photo-1589651013511-2ac4e9d1ddf4',  // a striped lawn under a clear sky
  field: 'photo-1573362924900-6395ff462288',    // striped lawn, big clouds
  crew: 'photo-1779636489740-6077a4198be6',     // two men mowing a front lawn
  rider: 'photo-1734303023481-7508b5c9f1ff',    // ride-on mower on a striped lawn
  bench: 'photo-1451933371645-a3029668b979',    // hands at a workbench
  painter: 'photo-1742900280861-32bed068938b',  // painter on a ladder
  truck: 'photo-1588111817213-1a12f73fbf20',    // pickup outside a row of houses
  saw: 'photo-1505798577917-a65157d3320a',      // man at a miter saw
};

const FAQS = [
  ['How much does Field Manager cost?', 'It is free for up to 5 customers and 20 jobs in total, invoicing included, with no credit card and no time limit. Pro is {{price}} a month, flat, and adds reports, team members and unlimited customers and jobs. New accounts get the Pro extras free for 14 days.'],
  ['Does it charge per user?', 'No. Team members are part of Pro, and Pro costs the same whether it is just you or a crew of eight.'],
  ['Does Field Manager process card payments?', 'No. Every invoice carries a pay-now link to your own Stripe, PayPal, Square or Venmo account, so the money goes straight to you and we take no cut. It does not store cards or charge customers automatically.'],
  ['Is there an app to download?', 'No download is needed. It runs in the browser on a phone, tablet or computer, and you can add it to your phone’s home screen so it opens like an app.'],
  ['Can I bring my existing customers over?', 'Yes. Import a CSV file, or send us your list in any form, a spreadsheet, an export from another app, or photos of a notebook, and we load it for you free, usually the same day.'],
];

function buildHome({ MOCKS, PHONE_CSS, unsplash, esc }) {
  const company = 'Acme Lawn & Landscape';
  const img = (key, w) => unsplash(PHOTOS[key], w);
  const cards = [
    ['rider', 'No per-user fees.', 'A crew of eight pays what a solo operator pays.'],
    ['bench', 'No app to download.', 'It runs in the browser and sits on your home screen.'],
    ['painter', 'We load your customer list.', 'Send it in any form. Free, usually the same day.'],
    ['truck', 'Your money goes straight to you.', 'Pay-now links to your own account. We take no cut.'],
    ['saw', 'Leave whenever you like.', 'Export your data at any time.'],
  ];
  const tabs = [
    ['schedule', 'Schedule', 'route', 'A calendar that knows your week.',
      'One-off jobs and repeating ones: weekly, every two weeks or monthly. Day, week and month views. Mark a visit complete from your phone.', null],
    ['paid', 'Get paid', 'invoices', 'Invoices that are already written.',
      'Completed work becomes a draft invoice. Every invoice carries a pay-now link to your own Stripe, PayPal, Square or Venmo. We never touch the money.', ['/pricing', 'See what is included']],
    ['referrals', 'Referrals', 'referrals', 'Your best customers become your sales team.',
      'Give each customer a booking link of their own. When a neighbor books through it, the referrer earns a share of each completed job as credit.', ['/referral-program', 'How the referral program works']],
  ];
  const trades = [['/lawncare', 'Lawn care'], ['/handyman', 'Handyman'], ['/painters', 'Painters'], ['/cleaners', 'Cleaners'], ['/detailers', 'Detailers'], ['/barbers', 'Barbers']];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>Field Manager — Run your service business in one place</title>
  <meta name="description" content="The calendar, customer book and invoicing for small service businesses. One flat price, no per-user fees. Free for your first five customers." />
  <meta name="robots" content="noindex, nofollow" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <meta name="theme-color" content="#0c1420" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preconnect" href="https://images.unsplash.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&display=swap">
  <script>document.documentElement.className = 'js';</script>
  <style>
    :root {
      --bg: #f7f4ec; --card: #ffffff; --text: #19170f; --text-muted: #66635c;
      --border: #e8e1d1; --border-strong: #d4cab4; --tinted: #efe7d3;
      --primary: #2c3e57; --primary-hover: #1b2940; --night: #0c1420;
      --serif: 'Fraunces', Georgia, 'Times New Roman', serif;
      --mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
      --gut: clamp(12px, 1.6vw, 20px); --r: clamp(22px, 2.6vw, 34px);
    }
    * { box-sizing: border-box; margin: 0; }
    html { -webkit-text-size-adjust: 100%; }
    body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; line-height: 1.6; overflow-x: clip; }
    img { display: block; max-width: 100%; }
    a { color: inherit; }
    :focus-visible { outline: 2px solid #7fa3d6; outline-offset: 3px; border-radius: 6px; }
    .wrap { max-width: 1180px; margin: 0 auto; padding-inline: clamp(20px, 4vw, 40px); }
    .mono { font-family: var(--mono); font-size: 11.5px; letter-spacing: 0.14em; text-transform: uppercase; display: inline-flex; align-items: center; gap: 10px; }
    .mono::before { content: ''; width: 6px; height: 6px; background: currentColor; }
    h1, h2, h3 { font-family: var(--serif); font-weight: 500; letter-spacing: -0.02em; line-height: 1.06; text-wrap: balance; }
    em { font-style: italic; }

    /* ---- pills: the nav and every button ---- */
    .pill {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      min-height: 46px; padding: 0 22px; border-radius: 999px; border: 1px solid transparent;
      font: 600 15px/1 'Inter', sans-serif; text-decoration: none; cursor: pointer; white-space: nowrap;
      transition: background .2s, color .2s, transform .2s, box-shadow .2s;
    }
    .pill--dark { background: var(--primary); color: #fff; }
    .pill--dark:hover { background: var(--primary-hover); transform: translateY(-1px); }
    .pill--light { background: #fff; color: var(--text); border-color: var(--border); box-shadow: 0 1px 2px rgba(25,23,15,.06), 0 10px 24px -14px rgba(25,23,15,.35); }
    .pill--light:hover { transform: translateY(-1px); }
    .pill--glass { background: rgba(255,255,255,.72); color: var(--text); border-color: rgba(255,255,255,.6); -webkit-backdrop-filter: blur(14px) saturate(1.4); backdrop-filter: blur(14px) saturate(1.4); box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 12px 28px -16px rgba(0,0,0,.45); }
    .pill--lg { min-height: 54px; padding: 0 28px; font-size: 16px; }
    .nav { position: fixed; inset: 0 0 auto 0; z-index: 50; display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: max(14px, env(safe-area-inset-top)) clamp(14px, 2.4vw, 28px) 0; pointer-events: none; }
    .nav > * { pointer-events: auto; }
    .nav-brand { font-family: var(--serif); font-weight: 600; font-size: 18px; letter-spacing: -0.01em; padding: 0 18px 0 12px; }
    .nav-brand img { width: 24px; height: 24px; }
    .nav-right { display: flex; gap: 8px; }
    @media (max-width: 560px) { .nav-hide { display: none; } }

    /* ---- the opening scene ----
       .hs is tall; .hs-stick pins to the viewport while you scroll through it.
       JS writes one number, --p (0 at the top, 1 at the end), and everything
       below is that number cut into overlapping stretches:
         --t  the headline leaves        --a  night gives way to morning
         --b  the phone rises            --d  its caption arrives
         --c  the whole scene shrinks into a rounded card and lets go      */
    .hs { --p: 0; position: relative; height: 100vh; height: 100svh; }
    .js .hs { height: 340vh; }
    .hs-stick {
      position: sticky; top: 0; height: 100vh; height: 100svh; overflow: hidden;
      --t: clamp(0, calc((var(--p) - 0.02) / 0.16), 1);
      --a: clamp(0, calc((var(--p) - 0.08) / 0.30), 1);
      --b: clamp(0, calc((var(--p) - 0.22) / 0.36), 1);
      --d: clamp(0, calc((var(--p) - 0.52) / 0.14), 1);
      --c: clamp(0, calc((var(--p) - 0.80) / 0.20), 1);
    }
    .hs-frame { position: absolute; inset: calc(var(--c) * var(--gut)); border-radius: calc(var(--c) * var(--r)); overflow: hidden; background: var(--night); }
    .hs-frame > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .hs-dusk { filter: brightness(.62) saturate(.9); scale: calc(1.08 - var(--a) * 0.08); }
    .hs-morning { opacity: var(--a); scale: calc(1.12 - var(--b) * 0.12); }
    .hs-shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(12,20,32,.5), rgba(12,20,32,0) 34%, rgba(12,20,32,0) 60%, rgba(12,20,32,.5)); }
    .hs-title { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 26px; padding: 0 24px; text-align: center; color: #fff; opacity: calc(1 - var(--t)); translate: 0 calc(var(--t) * -40px); }
    .hs-title h1 { font-size: clamp(40px, 7.4vw, 104px); font-weight: 400; max-width: 12em; text-shadow: 0 2px 30px rgba(0,0,0,.35); }
    .hs-title h1 em { color: #f3d9a4; }
    .hs-scroll { font: 500 15px 'Inter', sans-serif; display: inline-flex; align-items: center; gap: 10px; opacity: .9; }
    .hs-scroll i { width: 1px; height: 30px; background: currentColor; display: block; animation: nudge 1.8s ease-in-out infinite; transform-origin: top; }
    @keyframes nudge { 0%, 100% { scale: 1 .4; opacity: .5; } 50% { scale: 1 1; opacity: 1; } }
    .hs-phone { --lift: 0px; position: absolute; left: 50%; top: 50%; translate: -50% calc(-50% + var(--lift) + (1 - var(--b)) * 92vh); rotate: calc((1 - var(--b)) * 5deg); }
    .hs-phone .pd-phone { --pd-w: 292; box-shadow: 0 0 0 1px #2a2e36 inset, 0 50px 90px -30px rgba(0,0,0,.6); }
    @media (max-height: 780px) { .hs-phone .pd-phone { --pd-w: 250; } }
    @media (max-height: 660px) { .hs-phone .pd-phone { --pd-w: 212; } }
    .hs-cap { position: absolute; left: clamp(20px, 4vw, 56px); bottom: clamp(24px, 6vh, 64px); max-width: 300px; color: #fff; opacity: var(--d); translate: 0 calc((1 - var(--d)) * 18px); text-shadow: 0 1px 18px rgba(0,0,0,.45); }
    .hs-cap p { font-family: var(--serif); font-size: clamp(22px, 2.4vw, 30px); line-height: 1.15; margin-top: 12px; }
    /* On a phone the caption goes above the handset, so the handset is smaller
       and sits lower to leave it room. */
    @media (max-width: 760px) {
      .hs-cap { left: 0; right: 0; bottom: auto; top: 84px; max-width: none; text-align: center; padding: 0 20px; }
      .hs-cap p { font-size: 20px; margin-top: 8px; }
      .hs-cap .mono { justify-content: center; }
      .hs-phone { --lift: 64px; }
      .hs-phone .pd-phone { --pd-w: 228; }
    }
    @media (max-width: 760px) and (max-height: 700px) { .hs-phone .pd-phone { --pd-w: 196; } }
    @media (prefers-reduced-motion: reduce) { .js .hs { height: 100vh; height: 100svh; } .hs-scroll i { animation: none; } }

    /* ---- the statement ---- */
    .say { text-align: center; padding: clamp(72px, 12vw, 150px) 0 clamp(64px, 9vw, 120px); }
    .say h2 { font-size: clamp(30px, 4.6vw, 60px); max-width: 17em; margin: 0 auto; }
    .say h2 span { color: var(--text-muted); }
    .say p { color: var(--text-muted); font-size: clamp(16px, 1.5vw, 19px); margin: 22px auto 0; max-width: 34em; }
    .say p b { color: var(--text); font-weight: 600; }
    .acts { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin-top: 32px; }
    .trust { font-size: 13px; color: var(--text-muted); margin-top: 18px; text-wrap: balance; }

    /* ---- photograph cards ---- */
    .cards { padding-inline: var(--gut); display: grid; gap: var(--gut); }
    .pc { position: relative; border-radius: var(--r); overflow: hidden; background: var(--night); color: #fff; isolation: isolate; }
    .pc > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -2; }
    .pc::after { content: ''; position: absolute; inset: 0; z-index: -1; background: linear-gradient(180deg, rgba(12,20,32,.55), rgba(12,20,32,.05) 45%, rgba(12,20,32,.6)); }
    .pc-big { min-height: min(92vh, 860px); display: grid; grid-template-rows: auto 1fr; padding: clamp(24px, 4vw, 52px) clamp(22px, 4vw, 52px) 0; }
    .pc-big h2 { font-size: clamp(28px, 3.6vw, 48px); font-weight: 400; margin-top: 16px; max-width: 14em; }
    .pc-big .pc-phone { align-self: end; justify-self: center; margin-bottom: -210px; margin-top: 40px; }
    .pc-big .pd-phone { --pd-w: 300; }
    @media (max-width: 600px) { .pc-big .pd-phone { --pd-w: 250; } .pc-big .pc-phone { margin-bottom: -170px; } }
    .duo { display: grid; grid-template-columns: 1fr 1fr; gap: var(--gut); }
    @media (max-width: 760px) { .duo { grid-template-columns: 1fr; } }
    .pc-half { min-height: clamp(460px, 56vw, 640px); display: flex; flex-direction: column; justify-content: flex-end; padding: clamp(22px, 3vw, 40px); }
    .pc-half h3 { font-size: clamp(22px, 2.3vw, 30px); font-weight: 400; }
    .pc-half p { margin-top: 10px; max-width: 30em; color: rgba(255,255,255,.86); font-size: 15.5px; }
    .pc-wash { background: radial-gradient(120% 90% at 20% 0%, #5d7f6a 0%, #2f4a45 45%, #1a2a35 100%); }
    .pc-wash::after { display: none; }
    .note { align-self: flex-start; margin: 0 0 auto; margin-top: clamp(30px, 8vw, 90px); max-width: 320px; background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.28); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); border-radius: 22px; padding: 18px 20px; }
    .note .mono { font-size: 10.5px; opacity: .85; }
    .note b { display: block; font-size: 17px; margin-top: 10px; font-weight: 600; }
    .note span { display: block; font-size: 14.5px; color: rgba(255,255,255,.86); margin-top: 3px; }
    .note-acts { display: flex; gap: 8px; margin-top: 14px; }
    .note-acts i { font: 600 13px/1 'Inter', sans-serif; font-style: normal; padding: 9px 14px; border-radius: 999px; background: #fff; color: var(--text); }
    .note-acts i + i { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,.4); }

    /* ---- the product, in tabs ---- */
    .prod { padding: clamp(80px, 11vw, 150px) 0 clamp(40px, 6vw, 80px); }
    .prod > .wrap > h2 { font-size: clamp(30px, 4.4vw, 58px); text-align: center; max-width: 15em; margin: 0 auto; }
    .prod > .wrap > h2 em { color: var(--primary); }
    .tablist { display: flex; justify-content: center; gap: 6px; margin: 34px auto 0; padding: 5px; background: var(--tinted); border-radius: 999px; width: max-content; max-width: 100%; }
    .tablist button { border: 0; background: none; font: 600 14.5px/1 'Inter', sans-serif; color: var(--text-muted); padding: 12px 20px; border-radius: 999px; cursor: pointer; transition: background .2s, color .2s; }
    .tablist button[aria-selected="true"] { background: #fff; color: var(--text); box-shadow: 0 1px 2px rgba(25,23,15,.1); }
    .panel { margin-top: 26px; border-radius: var(--r); background: radial-gradient(90% 120% at 85% 10%, #f3dcc0 0%, rgba(243,220,192,0) 60%), var(--tinted); display: grid; grid-template-columns: 1fr 1fr; align-items: center; gap: 24px; padding: clamp(28px, 5vw, 72px) clamp(24px, 5vw, 72px) 0; overflow: hidden; }
    .panel[hidden] { display: none; }
    .panel-copy { padding-bottom: clamp(28px, 5vw, 72px); }
    .panel-copy h3 { font-size: clamp(26px, 3vw, 40px); margin-top: 16px; }
    .panel-copy p { color: var(--text-muted); font-size: 17px; margin-top: 14px; max-width: 28em; }
    .panel-copy a { display: inline-block; margin-top: 20px; font-weight: 600; text-underline-offset: 4px; }
    .panel-phone { justify-self: center; margin-bottom: -150px; }
    .panel-phone .pd-phone { --pd-w: 290; }
    @media (max-width: 820px) { .panel { grid-template-columns: 1fr; text-align: center; } .panel-copy p { margin-inline: auto; } .panel-copy { padding-bottom: 0; } .panel-copy .mono { justify-content: center; } .panel-phone .pd-phone { --pd-w: 250; } .panel-phone { margin-bottom: -140px; } }

    /* ---- the card row ---- */
    .row { padding: clamp(50px, 7vw, 100px) 0; }
    .row-head { display: flex; align-items: end; justify-content: space-between; gap: 20px; }
    .row-head h2 { font-size: clamp(26px, 3.2vw, 42px); max-width: 13em; margin-top: 14px; }
    .row-nav { display: flex; gap: 8px; }
    .row-nav button { width: 46px; height: 46px; border-radius: 50%; border: 1px solid var(--border-strong); background: #fff; font-size: 18px; cursor: pointer; }
    .row-nav button:hover { background: var(--tinted); }
    .track { display: flex; gap: var(--gut); overflow-x: auto; scroll-snap-type: x mandatory; padding: 28px max(clamp(20px, 4vw, 40px), calc((100vw - 1180px) / 2 + 40px)) 12px; scrollbar-width: none; }
    .track::-webkit-scrollbar { display: none; }
    .fc { flex: 0 0 min(78vw, 340px); aspect-ratio: 3 / 4; scroll-snap-align: center; display: flex; flex-direction: column; justify-content: flex-end; padding: 24px; }
    .fc::after { background: linear-gradient(180deg, rgba(12,20,32,0) 35%, rgba(12,20,32,.82)); }
    .fc b { font-family: var(--serif); font-weight: 500; font-size: 23px; line-height: 1.15; }
    .fc span { font-size: 14.5px; color: rgba(255,255,255,.86); margin-top: 8px; }

    /* ---- who it is for, and what it costs ---- */
    .for { text-align: center; padding: clamp(30px, 5vw, 60px) 0; }
    .for h2 { font-size: clamp(24px, 2.8vw, 36px); }
    .chips { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 24px; }
    .price { padding: clamp(50px, 7vw, 100px) 0; }
    .price-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--gut); margin-top: 30px; }
    @media (max-width: 700px) { .price-grid { grid-template-columns: 1fr; } }
    .price h2 { font-size: clamp(28px, 3.6vw, 48px); text-align: center; }
    .plan { border-radius: var(--r); padding: clamp(26px, 3.4vw, 44px); background: #fff; border: 1px solid var(--border); }
    .plan--pro { background: var(--primary); color: #fff; border-color: var(--primary); }
    .plan .k { font-family: var(--serif); font-size: clamp(40px, 5vw, 64px); line-height: 1; margin-top: 14px; letter-spacing: -0.03em; }
    .plan .k small { font: 500 15px 'Inter', sans-serif; letter-spacing: 0; opacity: .75; }
    .plan ul { list-style: none; padding: 0; margin-top: 22px; display: grid; gap: 9px; font-size: 15.5px; }
    .plan li { padding-left: 22px; position: relative; }
    .plan li::before { content: ''; position: absolute; left: 0; top: .62em; width: 10px; height: 2px; background: currentColor; opacity: .5; }
    .price-more { text-align: center; margin-top: 22px; font-weight: 600; }

    /* ---- questions ---- */
    .faq { margin: 0 var(--gut); border-radius: var(--r); background: var(--tinted); padding: clamp(50px, 7vw, 100px) 0; }
    .faq h2 { font-size: clamp(34px, 5vw, 64px); text-align: center; font-weight: 400; }
    .faq-list { max-width: 760px; margin: 34px auto 0; display: grid; gap: 10px; justify-items: start; }
    .faq details { max-width: 100%; }
    .faq summary { list-style: none; display: inline-flex; align-items: center; gap: 12px; cursor: pointer; background: #fff; border-radius: 999px; padding: 12px 12px 12px 20px; font-weight: 600; font-size: 15.5px; box-shadow: 0 1px 2px rgba(25,23,15,.06); }
    .faq summary::-webkit-details-marker { display: none; }
    .faq summary::after { content: '+'; flex: none; width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--border-strong); display: grid; place-items: center; font-weight: 400; font-size: 18px; line-height: 1; transition: rotate .2s; }
    .faq details[open] summary::after { rotate: 45deg; }
    .faq details p { background: rgba(25,23,15,.06); border-radius: 22px; padding: 18px 22px; margin-top: 10px; color: var(--text-muted); font-size: 15.5px; }

    /* ---- the close ---- */
    .end { text-align: center; padding: clamp(80px, 12vw, 160px) 0 clamp(40px, 6vw, 70px); }
    .end h2 { font-size: clamp(36px, 6vw, 84px); font-weight: 400; }
    .end h2 em { color: var(--primary); }
    footer { padding: 0 0 max(24px, env(safe-area-inset-bottom)); overflow: hidden; }
    .foot-links { display: flex; flex-wrap: wrap; gap: 8px 22px; justify-content: center; font-size: 14px; color: var(--text-muted); }
    .foot-links a { text-decoration: none; }
    .foot-links a:hover { color: var(--text); text-decoration: underline; }
    .wordmark { font-family: var(--serif); font-weight: 500; font-size: clamp(60px, 16.5vw, 280px); line-height: .82; letter-spacing: -0.045em; text-align: center; white-space: nowrap; color: var(--text); margin-top: clamp(30px, 5vw, 60px); opacity: .92; }
    .fine { text-align: center; font-size: 12.5px; color: var(--text-muted); margin-top: 22px; }

    /* Sections ease in as they arrive. Only with JS, so nothing is ever left
       invisible; and not at all for people who ask for less motion. */
    @media (prefers-reduced-motion: no-preference) {
      .js .rv { opacity: 0; translate: 0 22px; transition: opacity .7s ease, translate .7s ease; }
      .js .rv.in { opacity: 1; translate: 0 0; }
    }

    /* The phone's tab-bar icons: the two rules the phone CSS expects from its host page. */
    .icon { display: inline-block; width: 1em; height: 1em; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; fill: none; }
    .icon-glyph text { fill: currentColor; stroke: none; font: 600 20px 'Inter', sans-serif; }

    ${PHONE_CSS}
  </style>
</head>
<body>
  <nav class="nav" aria-label="Main">
    <a class="pill pill--glass nav-brand" href="/"><img src="/favicon.svg" alt="" />Field Manager</a>
    <div class="nav-right">
      <a class="pill pill--glass nav-hide" href="/pricing">Pricing</a>
      <a class="pill pill--glass nav-hide" href="/signin">Sign in</a>
      <a class="pill pill--dark" href="/signup">Start free</a>
    </div>
  </nav>

  <header class="hs" id="scene">
    <div class="hs-stick">
      <div class="hs-frame">
        <img class="hs-dusk" src="${img('dusk', 1800)}" alt="" fetchpriority="high" />
        <img class="hs-morning" src="${img('morning', 1800)}" alt="" />
        <div class="hs-shade"></div>
        <div class="hs-title">
          <h1>Stop running your business from <em>spreadsheets.</em></h1>
          <span class="hs-scroll">Scroll <i></i></span>
        </div>
        <div class="hs-phone">${MOCKS.route(company)}</div>
        <div class="hs-cap"><span class="mono">Tuesday, 8:00 AM</span><p>Three visits. $245. All of it on one screen.</p></div>
      </div>
    </div>
  </header>

  <main>
    <section class="say wrap rv">
      <h2>The calendar, customer book and invoicing <span>for the person who answers their own phone.</span></h2>
      <p><b>{{price}} a month, flat.</b> No per-user fees, no sales call.</p>
      <div class="acts">
        <a class="pill pill--dark pill--lg" href="/signup">Start free — no card</a>
        <a class="pill pill--light pill--lg" href="/demo">Try the live demo</a>
      </div>
      <p class="trust">Free for your first five customers · Set up in under two minutes · No card to start</p>
    </section>

    <div class="cards">
      <section class="pc pc-big rv">
        <img src="${img('field', 1800)}" alt="A freshly striped lawn under a wide sky" loading="lazy" />
        <div>
          <span class="mono">One place for the whole job</span>
          <h2>From the first call to the paid invoice.</h2>
        </div>
        <div class="pc-phone">${MOCKS.quote(company)}</div>
      </section>
      <div class="duo">
        <section class="pc pc-half rv">
          <img src="${img('crew', 1200)}" alt="Two men mowing and trimming a front lawn" loading="lazy" />
          <h3>Get the paperwork off your mind.</h3>
          <p>Jobs repeat on their own schedule. Completed visits roll into one invoice per customer at the end of the month.</p>
        </section>
        <section class="pc pc-half pc-wash rv">
          <div class="note" role="img" aria-label="A booking request from a new customer, referred by an existing one">
            <span class="mono">New booking request</span>
            <b>Marcus Bell</b>
            <span>Weekly mowing, same as Heather’s. Referred by Heather Stahl.</span>
            <div class="note-acts"><i>Accept</i><i>Decline</i></div>
          </div>
          <h3>New work finds you.</h3>
          <p>A booking page and QR code of your own. Requests land in the app for you to accept or decline.</p>
        </section>
      </div>
    </div>

    <section class="prod">
      <div class="wrap">
        <h2 class="rv">Do the work. <em>The invoice is already written.</em></h2>
        <div class="tablist" role="tablist" aria-label="What it does">
          ${tabs.map(([id, label], n) => `<button role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="${n === 0}"${n ? ' tabindex="-1"' : ''}>${label}</button>`).join('')}
        </div>
        ${tabs.map(([id, label, mock, title, text, link], n) => `<div class="panel" role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}"${n ? ' hidden' : ''}>
          <div class="panel-copy">
            <span class="mono">${label}</span>
            <h3>${title}</h3>
            <p>${text}</p>
            ${link ? `<a href="${link[0]}">${link[1]}</a>` : ''}
          </div>
          <div class="panel-phone">${MOCKS[mock](company)}</div>
        </div>`).join('\n        ')}
      </div>
    </section>

    <section class="row">
      <div class="wrap row-head rv">
        <div><span class="mono">What you will not be charged for</span><h2>Priced for a business of one. Or eight.</h2></div>
        <div class="row-nav"><button type="button" id="row-prev" aria-label="Previous cards">←</button><button type="button" id="row-next" aria-label="More cards">→</button></div>
      </div>
      <div class="track" id="track">
        ${cards.map(([key, title, text]) => `<article class="pc fc"><img src="${img(key, 900)}" alt="" loading="lazy" /><b>${title}</b><span>${text}</span></article>`).join('\n        ')}
      </div>
    </section>

    <section class="for wrap rv">
      <h2>Built for the trades that work by the visit.</h2>
      <div class="chips">${trades.map(([href, label]) => `<a class="pill pill--light" href="${href}">${label}</a>`).join('')}</div>
    </section>

    <section class="price wrap">
      <h2 class="rv">Two plans. One flat price.</h2>
      <div class="price-grid">
        <div class="plan rv">
          <span class="mono">Free</span>
          <div class="k">$0</div>
          <ul><li>Up to 5 customers and 20 jobs</li><li>Scheduling, quotes and invoicing</li><li>Pay-now links and a booking page</li><li>No card, no time limit</li></ul>
        </div>
        <div class="plan plan--pro rv">
          <span class="mono">Pro</span>
          <div class="k">{{price}} <small>a month, flat{{offer_note}}</small></div>
          <ul><li>Unlimited customers and jobs</li><li>Your whole crew, at no extra cost</li><li>Reports: revenue, projected income, top customers</li><li>Cancel any time, export your data</li></ul>
        </div>
      </div>
      <p class="price-more"><a href="/pricing">Everything on the pricing page</a></p>
    </section>

    <section class="faq rv">
      <div class="wrap">
        <h2>Questions</h2>
        <div class="faq-list">
          ${FAQS.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${a}</p></details>`).join('\n          ')}
        </div>
      </div>
    </section>

    <section class="end wrap rv">
      <h2>Run tomorrow’s jobs <em>from it.</em></h2>
      <div class="acts">
        <a class="pill pill--dark pill--lg" href="/signup">Start free — no card</a>
        <a class="pill pill--light pill--lg" href="/demo">Try the live demo</a>
      </div>
    </section>
  </main>

  <footer>
    <div class="foot-links wrap">
      <a href="/pricing">Pricing</a><a href="/about">About</a><a href="/use-cases">Use cases</a><a href="/referral-program">Referral program</a><a href="/learn">Learn</a><a href="/tools">Free tools</a><a href="/contact">Contact</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a>
    </div>
    <div class="wordmark" aria-hidden="true">Field Manager</div>
    <p class="fine">© Field Manager · Photographs from Unsplash</p>
  </footer>

  <script>
  (function () {
    var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // The opening scene: how far through .hs the page has scrolled, 0 to 1,
    // written to --p. Read on scroll, written once per frame.
    var scene = document.getElementById('scene'), queued = false;
    function measure() {
      queued = false;
      var span = scene.offsetHeight - window.innerHeight;
      var p = span > 0 ? Math.min(1, Math.max(0, -scene.getBoundingClientRect().top / span)) : 0;
      scene.style.setProperty('--p', p.toFixed(4));
    }
    if (!calm) {
      window.addEventListener('scroll', function () { if (!queued) { queued = true; requestAnimationFrame(measure); } }, { passive: true });
      window.addEventListener('resize', measure);
      measure();
    }

    // Sections ease in as they arrive.
    var rv = document.querySelectorAll('.rv');
    if ('IntersectionObserver' in window && !calm) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
      }, { rootMargin: '0px 0px -8% 0px' });
      rv.forEach(function (el) { io.observe(el); });
    } else { rv.forEach(function (el) { el.classList.add('in'); }); }

    // Tabs: click, or the arrow keys.
    var tabs = [].slice.call(document.querySelectorAll('[role="tab"]'));
    function pick(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', on);
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
      if (focus) tab.focus();
    }
    tabs.forEach(function (t, n) {
      t.addEventListener('click', function () { pick(t); });
      t.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') pick(tabs[(n + 1) % tabs.length], true);
        if (e.key === 'ArrowLeft') pick(tabs[(n + tabs.length - 1) % tabs.length], true);
      });
    });

    // The card row's arrows move it one card at a time.
    var track = document.getElementById('track');
    function step(dir) {
      var card = track.querySelector('.fc');
      track.scrollBy({ left: dir * (card.offsetWidth + 16), behavior: calm ? 'auto' : 'smooth' });
    }
    document.getElementById('row-prev').addEventListener('click', function () { step(-1); });
    document.getElementById('row-next').addEventListener('click', function () { step(1); });
  })();
  </script>
</body>
</html>`;
}

module.exports = { buildHome };
