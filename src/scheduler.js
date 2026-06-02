// In-process scheduler. Runs alongside the web server so we don't need a
// separate Railway cron service. Ticks every 60 seconds and fires each job
// once per UTC day after its scheduled hour.
//
// Both target scripts are idempotent — auto-invoice tracks billed_dates per
// job, trial reminders track per-milestone sent_at columns — so running
// more than once on the same day is safe even across restarts.
//
// Disable via DISABLE_SCHEDULER=1 (useful in dev or if you ever move back
// to dedicated Railway cron services).

const { main: runAutoInvoices } = require('../scripts/run-auto-invoices');
const { main: runTrialReminders } = require('../scripts/send-trial-reminders');

const SCHEDULE = {
  autoInvoice:   { utcHour: 9,  envFlag: 'DISABLE_AUTO_INVOICE_CRON' },
  trialReminder: { utcHour: 14, envFlag: 'DISABLE_TRIAL_REMINDER_CRON' },
};

// In-memory "last run" date per job. Resets on restart, but the jobs are
// idempotent so the worst case is one duplicate scan after a redeploy.
const lastRunDate = {
  autoInvoice: '',
  trialReminder: '',
};

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

async function maybeRun(jobName, runFn) {
  const cfg = SCHEDULE[jobName];
  if (process.env[cfg.envFlag] === '1') return;
  const now = new Date();
  const today = todayUTC();
  if (now.getUTCHours() < cfg.utcHour) return;
  if (lastRunDate[jobName] === today) return;
  lastRunDate[jobName] = today;
  console.log(`[scheduler] firing ${jobName} for ${today}`);
  try {
    await runFn();
    console.log(`[scheduler] ${jobName} completed`);
  } catch (err) {
    console.error(`[scheduler] ${jobName} failed:`, err);
  }
}

async function tick() {
  await maybeRun('autoInvoice', runAutoInvoices);
  await maybeRun('trialReminder', runTrialReminders);
}

function start() {
  if (process.env.DISABLE_SCHEDULER === '1') {
    console.log('[scheduler] disabled via DISABLE_SCHEDULER=1');
    return;
  }
  console.log('[scheduler] starting in-process scheduler');
  // Give the web server a moment to come up before the first tick, then
  // check every minute.
  setTimeout(tick, 10 * 1000);
  setInterval(tick, 60 * 1000);
}

module.exports = { start, tick };
