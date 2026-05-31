const express = require('express');
const Stripe = require('stripe');
const { query } = require('../config/db');

const router = express.Router();

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('Stripe webhook fired but STRIPE keys not configured');
    return res.status(500).send('Not configured');
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Stripe webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        const orgId = s.client_reference_id || (s.metadata && s.metadata.organization_id);
        if (orgId && s.customer && s.subscription) {
          await query(
            `UPDATE organizations
             SET stripe_customer_id = $2,
                 stripe_subscription_id = $3,
                 subscription_status = 'active',
                 updated_at = NOW()
             WHERE id = $1`,
            [orgId, s.customer, s.subscription]
          );
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object;
        const orgId = sub.metadata && sub.metadata.organization_id;
        const dbStatus = mapStripeStatus(sub.status);
        if (orgId && dbStatus) {
          await query(
            `UPDATE organizations
             SET stripe_customer_id = $2,
                 stripe_subscription_id = $3,
                 subscription_status = $4,
                 updated_at = NOW()
             WHERE id = $1`,
            [orgId, sub.customer, sub.id, dbStatus]
          );
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const orgId = sub.metadata && sub.metadata.organization_id;
        if (orgId) {
          await query(
            `UPDATE organizations
             SET subscription_status = 'canceled',
                 stripe_subscription_id = NULL,
                 updated_at = NOW()
             WHERE id = $1`,
            [orgId]
          );
        }
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object;
        if (inv.subscription) {
          await query(
            `UPDATE organizations
             SET subscription_status = 'past_due', updated_at = NOW()
             WHERE stripe_subscription_id = $1`,
            [inv.subscription]
          );
        }
        break;
      }
      default:
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    res.status(500).send('Webhook handler error');
  }
});

function mapStripeStatus(s) {
  if (s === 'trialing') return 'trialing';
  if (s === 'active') return 'active';
  if (s === 'past_due' || s === 'unpaid') return 'past_due';
  if (s === 'canceled' || s === 'incomplete_expired') return 'canceled';
  return null;
}

module.exports = router;
