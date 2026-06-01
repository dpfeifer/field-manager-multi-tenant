const express = require('express');
const Stripe = require('stripe');
const { query } = require('../config/db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    const err = new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)');
    err.status = 500;
    throw err;
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

router.get('/status', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT subscription_status, trial_ends_at, stripe_customer_id, stripe_subscription_id
       FROM organizations WHERE id = $1 LIMIT 1`,
      [req.organization.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const o = rows[0];
    res.json({
      status: o.subscription_status,
      trial_ends_at: o.trial_ends_at,
      has_subscription: !!o.stripe_subscription_id,
    });
  } catch (err) { next(err); }
});

router.post('/checkout', requireRole('admin'), async (req, res, next) => {
  if (!process.env.STRIPE_PRICE_ID) {
    return res.status(500).json({ error: 'STRIPE_PRICE_ID is not configured' });
  }

  try {
    const { rows } = await query(
      'SELECT name, slug, stripe_customer_id FROM organizations WHERE id = $1 LIMIT 1',
      [req.organization.id]
    );
    const org = rows[0];
    const origin = req.protocol + '://' + req.get('host');

    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      customer: org.stripe_customer_id || undefined,
      customer_email: org.stripe_customer_id ? undefined : req.user.email,
      client_reference_id: req.organization.id,
      metadata: { organization_id: req.organization.id, organization_slug: org.slug },
      subscription_data: {
        metadata: { organization_id: req.organization.id, organization_slug: org.slug },
        description: 'Field Manager — monthly subscription',
      },
      success_url: `${origin}/billing?success=true`,
      cancel_url: `${origin}/billing?canceled=true`,
      allow_promotion_codes: true,
      custom_text: {
        submit: { message: 'You can cancel any time from the Billing tab.' },
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    if (err.type && err.type.startsWith('Stripe')) {
      return res.status(400).json({ error: `Stripe: ${err.message}`, code: err.code || null });
    }
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/portal', requireRole('admin'), async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT stripe_customer_id FROM organizations WHERE id = $1 LIMIT 1',
      [req.organization.id]
    );
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) {
      return res.status(400).json({ error: 'No Stripe customer for this organization yet. Start a subscription first.' });
    }
    const origin = req.protocol + '://' + req.get('host');
    const session = await stripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/billing`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe portal error:', err);
    if (err.type && err.type.startsWith('Stripe')) {
      return res.status(400).json({ error: `Stripe: ${err.message}`, code: err.code || null });
    }
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// Manual trigger for the auto-invoice rollup. Admin-initiated, useful for
// testing the schedule before relying on the cron.
const { runAutoInvoiceForOrg } = require('../utils/autoInvoice');
router.post('/auto-invoice/run', requireRole('admin'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT auto_invoice_schedule FROM organization_settings WHERE organization_id = $1 LIMIT 1`,
      [req.organization.id]
    );
    const schedule = (rows[0] && rows[0].auto_invoice_schedule) || 'monthly';
    if (schedule === 'off') {
      return res.status(400).json({ error: "Auto-invoice schedule is 'off'. Pick a schedule in Settings first." });
    }
    const result = await runAutoInvoiceForOrg(req.organization.id, {
      schedule: schedule === 'off' ? 'monthly' : schedule,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// Admin-initiated self-destruct: deletes the org permanently. Mirrors the
// staff version in routes/system.js but requires the admin to type their
// own slug into confirm_slug.
router.post('/cancel-account', requireRole('admin'), async (req, res, next) => {
  const { confirm_slug } = req.body || {};
  try {
    const { rows } = await query(
      'SELECT slug, name, stripe_subscription_id FROM organizations WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
      [req.organization.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const org = rows[0];
    if (confirm_slug !== org.slug) {
      return res.status(400).json({ error: `Type "${org.slug}" exactly to confirm.` });
    }

    if (org.stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
      try {
        await stripe().subscriptions.cancel(org.stripe_subscription_id);
      } catch (err) {
        console.warn(`stripe cancel failed during self-destruct (${org.slug}):`, err.message);
      }
    }

    await query('DELETE FROM organizations WHERE id = $1', [req.organization.id]);
    res.json({ ok: true, deleted_slug: org.slug });
  } catch (err) { next(err); }
});

module.exports = router;
