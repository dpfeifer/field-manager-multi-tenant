#!/usr/bin/env node
/*
 * Seeds a local development database with one organization and enough data
 * that every screen has something real on it — a day with priced jobs, a
 * recurring job with history, invoices in each status, a quote, a customer
 * carrying both a balance and a credit.
 *
 * Local only, and it refuses to run against anything that looks remote: the
 * first thing it does is delete the org it is about to recreate.
 *
 *   npm run seed
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const { query, withTransaction } = require('../src/config/db');

const SLUG = 'acme';
const EMAIL = 'dev@example.com';
const PASSWORD = 'password123';

const url = process.env.DATABASE_URL || '';
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error('[seed] refusing to run: DATABASE_URL is not local.\n        ' + url.replace(/:[^:@]*@/, ':****@'));
  process.exit(1);
}

// Dates relative to today, so the schedule is always current no matter when
// this is run — a seed with hardcoded dates stops being useful in a week.
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const CUSTOMERS = [
  { first: 'Patricia', last: 'Crowley',  phone: '555-217-8841', email: 'pat@example.com',    address: '412 Juniper Way',  notes: 'Gate code 4417. Dog is friendly.' },
  { first: 'Bob',      last: 'Henderson', phone: '555-302-1108', email: 'bob@example.com',    address: '88 Larkspur Ln' },
  { first: 'Marisol',  last: 'Vega',     phone: '555-889-2210', email: 'mvega@example.com',  address: '17 Cedar Ct',      notes: 'Prefers mornings, before 10.' },
  { first: 'Jerry',    last: 'McLemore', phone: '555-558-9912', email: 'jerry@example.com',  address: '2200 Sage Dr' },
  { first: 'Tiffany',  last: 'Ernest',   phone: '555-771-0044', email: 'tiff@example.com',   address: '64 Bluebell Rd' },
  { first: 'Henry',    last: 'Wells',    phone: '555-440-7781', email: 'henry@example.com',  address: '901 Aspen Pl' },
  { first: 'Dalida',   last: 'Islas',    phone: '555-099-4421', email: 'dalida@example.com', address: '330 Poppy St' },
  { business: 'Pine Street Apartments', phone: '555-660-2299', email: 'mgr@pinestreet.example', address: '88 Pine St', notes: 'Common-area lawn only. Annual contract.' },
  { business: "St. Mary's Church",      phone: '555-441-8800', email: 'office@stmarys.example', address: '5 Chapel Rd' },
  { business: 'Acme Office Park',       phone: '555-118-4044', email: 'facilities@acme.example', address: '1 Industrial Pkwy' },
];

async function main() {
  console.log('[seed] resetting organization "' + SLUG + '"');
  // Hard delete rather than soft, so repeated runs do not pile up orphans.
  const existing = await query('SELECT id FROM organizations WHERE slug = $1', [SLUG]);
  for (const org of existing.rows) {
    for (const t of ['team_messages', 'booking_requests', 'customer_credits', 'invoices',
                     'quotes', 'jobs', 'customer_notes', 'customers',
                     'organization_settings', 'users']) {
      await query(`DELETE FROM ${t} WHERE organization_id = $1`, [org.id]).catch(() => {});
    }
    await query('DELETE FROM organizations WHERE id = $1', [org.id]);
  }

  await withTransaction(async (c) => {
    const org = (await c.query(
      `INSERT INTO organizations (slug, name, subscription_status, trial_ends_at, next_invoice_number, timezone, onboarding_completed_at)
       VALUES ($1, $2, 'active', NOW() + INTERVAL '365 days', 1009, 'America/Los_Angeles', NOW())
       RETURNING id`,
      [SLUG, 'Acme Lawn Care']
    )).rows[0];

    await c.query(
      `INSERT INTO users (organization_id, email, password_hash, name, role, email_verified_at, password_set_at)
       VALUES ($1, $2, $3, 'Dustin', 'admin', NOW(), NOW())`,
      [org.id, EMAIL, bcrypt.hashSync(PASSWORD, 10)]
    );
    await c.query(
      `INSERT INTO users (organization_id, email, password_hash, name, role, email_verified_at, password_set_at)
       VALUES ($1, 'crew@example.com', $2, 'Sam (crew)', 'employee', NOW(), NOW())`,
      [org.id, bcrypt.hashSync(PASSWORD, 10)]
    );

    await c.query(
      `INSERT INTO organization_settings
         (organization_id, company_name, phone, email, address, about)
       VALUES ($1, 'Acme Lawn & Landscape', '(702) 555-0148', 'hi@acme.example',
               '1400 Ash Lane, Las Vegas, NV 89104',
               'Mowing, cleanup and hauling across the valley since 2014.')`,
      [org.id]
    );

    const ids = [];
    for (const cu of CUSTOMERS) {
      const r = await c.query(
        `INSERT INTO customers (organization_id, first_name, last_name, business_name, phone, email, address, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [org.id, cu.first || null, cu.last || null, cu.business || null,
         cu.phone, cu.email, cu.address, cu.notes || null]
      );
      ids.push(r.rows[0].id);
    }

    // A recurring job per customer, staggered so several land tomorrow and a
    // couple land today — the day view needs both a busy day and a quiet one.
    const prices = [55, 50, 60, 65, 50, 70, 45, 240, 120, 180];
    const titles = ['Weekly mowing', 'Weekly mowing', 'Weekly mowing', 'Biweekly mowing',
                    'Weekly mowing', 'Biweekly mowing', 'Weekly mowing',
                    'Weekly grounds maintenance', 'Grounds + hedges', 'Lot cleanup'];
    for (let i = 0; i < ids.length; i++) {
      const startsBack = 84 - (i % 7);
      await c.query(
        `INSERT INTO jobs (organization_id, customer_id, title, type, start_date,
                           recurrence_pattern, default_price, status, completed_dates)
         VALUES ($1,$2,$3,'recurring',$4,$5,$6,'active',$7::jsonb)`,
        [org.id, ids[i], titles[i], day(-startsBack),
         i % 4 === 3 ? 'biweekly' : 'weekly', prices[i],
         JSON.stringify([day(-startsBack), day(-startsBack + 7), day(-startsBack + 14)])]
      );
    }
    // Two one-off jobs today, so today is not empty.
    await c.query(
      `INSERT INTO jobs (organization_id, customer_id, title, description, type, date,
                         start_time, duration_minutes, default_price, status)
       VALUES ($1,$2,'Storm cleanup','Branches down along the north fence','single',$3,'09:00',120,180,'active')`,
      [org.id, ids[0], day(0)]
    );
    await c.query(
      `INSERT INTO jobs (organization_id, customer_id, title, type, date, default_price, status)
       VALUES ($1,$2,'Hedge trim','single',$3,95,'active')`,
      [org.id, ids[2], day(0)]
    );

    // Invoices across every status the filter offers.
    const invoices = [
      [ids[8], 1008, 'draft', 270, day(-1),  null],
      [ids[6], 1007, 'draft', 165, day(-2),  null],
      [ids[5], 1006, 'sent',  140, day(-4),  null],
      [ids[7], 1005, 'sent',  960, day(-7),  null],
      [ids[1], 1004, 'paid',   50, day(-12), day(-9)],
      [ids[3], 1003, 'paid',   65, day(-19), day(-16)],
      [ids[2], 1002, 'paid',   60, day(-26), day(-24)],
      [ids[4], 1001, 'paid',   50, day(-33), day(-30)],
    ];
    for (const [cust, num, status, amount, date, paid] of invoices) {
      await c.query(
        `INSERT INTO invoices (organization_id, customer_id, invoice_number, status,
                               description, date, sent_date, paid_date, line_items)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [org.id, cust, num, status, 'Monthly service', date,
         status === 'draft' ? null : date, paid,
         JSON.stringify([{ description: 'Monthly service', quantity: 1, rate: amount, amount }])]
      );
    }

    await c.query(
      `INSERT INTO quotes (organization_id, customer_id, status, description, line_items)
       VALUES ($1,$2,'sent','Spring cleanup',$3::jsonb)`,
      [org.id, ids[0],
       JSON.stringify([{ description: 'Spring cleanup', quantity: 1, rate: 480, amount: 480 }])]
    );

    await c.query(
      `INSERT INTO customer_credits (organization_id, customer_id, amount, note)
       VALUES ($1,$2,225,'Prepayment, cash')`,
      [org.id, ids[0]]
    );

    await c.query(
      `INSERT INTO booking_requests (organization_id, requester_name, requester_email, requester_phone,
                                     service_description, status, preferred_slots)
       VALUES ($1,'Nina Alvarez','nina@example.com','555-664-2211','Weekly mowing for a corner lot','pending','[]'::jsonb),
              ($1,'Owen Pratt','owen@example.com','555-330-7781','One-time hauling, garage cleanout','pending','[]'::jsonb),
              ($1,'Rosa Lin','rosa@example.com','555-220-9931','Quote for hedge work','pending','[]'::jsonb)`,
      [org.id]
    );

    console.log('[seed] organization ready');
  });

  const counts = {};
  for (const t of ['customers', 'jobs', 'invoices', 'quotes', 'booking_requests', 'users']) {
    counts[t] = Number((await query(`SELECT COUNT(*)::int n FROM ${t}`).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n);
  }
  console.log('[seed] ' + JSON.stringify(counts));
  console.log('[seed] sign in at /signin  slug: ' + SLUG + '  ' + EMAIL + ' / ' + PASSWORD);
  process.exit(0);
}

main().catch((err) => { console.error('[seed] failed:', err); process.exit(1); });
