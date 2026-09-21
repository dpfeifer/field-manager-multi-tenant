// The emails a new account gets after the welcome: one on day 2, one on day 7.
// Each looks at what the account has actually done and says the one next
// thing — not a drip campaign, a nudge from a person. They are written as
// Dustin, replies go to him, and every one carries a link that stops them.
const crypto = require('crypto');

const base = () => (process.env.APP_URL || 'https://fieldmgr.com').replace(/\/+$/, '');
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function optOutSig(orgId) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev').update(`lifecycle-stop:${orgId}`).digest('hex').slice(0, 32);
}
function optOutUrl(orgId) {
  return `${base()}/api/public/lifecycle/stop?org=${orgId}&sig=${optOutSig(orgId)}`;
}

// What to say, from where the account stands. `s` = { customers, jobs,
// completions, invoices, active_recently }. Returns { subject, lines[], cta }.
function pickMessage(milestone, s, words) {
  const c = words.customer, cs = words.customers, j = words.job;
  if (milestone === 'd2') {
    if (s.customers === 0) return {
      subject: `Want me to load your ${cs} for you?`,
      lines: [
        `Your account is set up, but there are no ${cs} in it yet.`,
        `Reply to this email with your list in any form: a spreadsheet, an export from another app, or photos of a notebook. I will load it for you, free, usually the same day.`,
        `Or add them yourself. One at a time, or import a CSV file.`,
      ],
      cta: [`Add a ${c}`, '/customers?new=1'],
    };
    if (s.jobs === 0) return {
      subject: `Next step: put a ${j} on the calendar`,
      lines: [
        `You have ${s.customers} ${s.customers === 1 ? c : cs} in. The next step is to schedule a ${j}.`,
        `If the work repeats, set it to weekly, every two weeks or monthly once. The calendar fills in from there.`,
      ],
      cta: [`Schedule a ${j}`, '/jobs'],
    };
    if (s.completions === 0) return {
      subject: `When a ${j} is done, tap Mark complete`,
      lines: [
        `You have ${cs} and ${s.jobs} ${s.jobs === 1 ? j : `${j}s`} scheduled.`,
        `When you finish one, tap Mark complete. That is what feeds invoicing: completed visits can roll up into one invoice per ${c} at the end of the month. You turn that on in Settings, under Auto-invoice.`,
      ],
      cta: ['Open today’s work', '/dashboard'],
    };
    return {
      subject: 'You are up and running',
      lines: [
        `You have ${cs}, ${j}s on the calendar, and completed work. That is the whole loop.`,
        `One setting worth a look: Settings, then Auto-invoice. It turns each month’s completed visits into draft invoices for you to review and send.`,
      ],
      cta: ['Open Auto-invoice', '/settings/auto-invoice'],
    };
  }
  // d7
  if (!s.active_recently || s.customers === 0) return {
    subject: 'Did something get in the way?',
    lines: [
      `You signed up a week ago and I have not seen much activity since.`,
      `If something was confusing, missing, or not what you expected, reply and tell me in one line. I read every reply.`,
      `If you just ran out of time: reply with your ${c} list in any form and I will set the account up for you, free.`,
    ],
    cta: ['Open Field Manager', '/dashboard'],
  };
  return {
    subject: 'One week in. Two things worth turning on',
    lines: [
      `You have been using Field Manager for a week. Two features most people find later than they should:`,
      `Your booking link. New ${cs} request work through it, and the request lands in your app. It is in Settings, under Share links.`,
      `Referrals. Give a ${c} their own link; when someone they send books, they earn credit with you. Turn it on in Settings, under Sections.`,
      `And if anything has annoyed you this week, reply and tell me.`,
    ],
    cta: ['Open Share links', '/settings/links'],
  };
}

function renderLifecycleEmail({ milestone, orgId, firstName, stats, words }) {
  const m = pickMessage(milestone, stats, words);
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  const stop = optOutUrl(orgId);
  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; padding:24px; max-width:600px; color:#2d2a26; line-height:1.6;">
  <p style="margin:0 0 12px;">${esc(greeting)}</p>
  ${m.lines.map((l) => `<p style="margin:0 0 12px; color:#444;">${esc(l)}</p>`).join('\n  ')}
  <p style="margin:18px 0 24px;"><a href="${base()}${m.cta[1]}" style="display:inline-block; background:#2c3e57; color:#fff; padding:11px 22px; border-radius:8px; text-decoration:none; font-weight:600;">${esc(m.cta[0])}</a></p>
  <p style="margin:0 0 24px; color:#6d6a64; font-size:13px;">— Dustin, Field Manager</p>
  <p style="margin:0; color:#8a867e; font-size:12px;">You are getting this because you created a Field Manager account. <a href="${stop}" style="color:#8a867e;">Stop these setup emails</a>.</p>
</body></html>`;
  const text = `${greeting}\n\n${m.lines.join('\n\n')}\n\n${m.cta[0]}: ${base()}${m.cta[1]}\n\n— Dustin, Field Manager\n\nStop these setup emails: ${stop}\n`;
  return { subject: m.subject, html, text };
}

module.exports = { renderLifecycleEmail, pickMessage, optOutSig, optOutUrl };
