// Generate realistic demo data for an org. Idempotent in the sense
// that the caller passes a fresh orgId — we don't try to wipe and
// re-seed an existing org.

const crypto = require('crypto');

const uuid = () => crypto.randomUUID();
const yyyymmdd = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(8, 0, 0, 0);
  return d;
};
const daysFromNow = (n) => daysAgo(-n);

// Eight customers with mixed residential / business names.
const CUSTOMERS = [
  { first: 'Patricia', last: 'Crowley',  phone: '555-217-8841', address: '418 Maple Ave',     notes: 'Gate code: 1218. Watch out for the dog.' },
  { first: 'Bob',      last: 'Henderson', phone: '555-302-1108', address: '14 Wells Rd',       notes: '' },
  { first: 'Marisol',  last: 'Vega',      phone: '555-447-2290', address: '7 Birchwood Ct',    notes: 'Likes a Friday afternoon slot.' },
  { first: 'Jerry',    last: 'McLemore',  phone: '555-558-9912', address: '92 Linden Hill Dr', notes: '' },
  { first: 'Tiffany',  last: 'Ernest',    phone: '555-771-0044', address: '301 Cedar Ln',      notes: 'Bills on the first.' },
  { first: 'Henry',    last: 'Wells',     phone: '555-885-3017', address: '226 Hawthorn St',   notes: '' },
  { first: 'Dalida',   last: 'Islas',     phone: '555-099-4421', address: '60 Sycamore Pl',    notes: 'Send invoices via email only.' },
  { first: null, last: null, business: 'St. Mary’s Church', phone: '555-441-8800', address: '12 Church St', notes: 'Bill the office, not Father Tom.' },
  { first: null, last: null, business: 'Pine Street Apartments', phone: '555-660-2299', address: '88 Pine St', notes: 'Common-area lawn only. Annual contract.' },
  { first: null, last: null, business: 'Acme Office Park',       phone: '555-118-4044', address: '500 Industrial Way', notes: '' },
];

// Eight recurring lawn jobs + two one-time projects + a few odd ones.
const JOB_TEMPLATES = [
  { customerIdx: 0, title: 'Weekly mowing',   type: 'recurring', recurrence: 'weekly',   price: 55, startOffset: -84 },
  { customerIdx: 1, title: 'Weekly mowing',   type: 'recurring', recurrence: 'weekly',   price: 50, startOffset: -77 },
  { customerIdx: 2, title: 'Weekly mowing',   type: 'recurring', recurrence: 'weekly',   price: 60, startOffset: -84 },
  { customerIdx: 3, title: 'Biweekly mowing', type: 'recurring', recurrence: 'biweekly', price: 65, startOffset: -84 },
  { customerIdx: 4, title: 'Weekly mowing',   type: 'recurring', recurrence: 'weekly',   price: 50, startOffset: -70 },
  { customerIdx: 5, title: 'Biweekly mowing', type: 'recurring', recurrence: 'biweekly', price: 70, startOffset: -84 },
  { customerIdx: 6, title: 'Weekly mowing',   type: 'recurring', recurrence: 'weekly',   price: 55, startOffset: -63 },
  { customerIdx: 7, title: 'Weekly mowing',   type: 'recurring', recurrence: 'weekly',   price: 90, startOffset: -77 },
  { customerIdx: 8, title: 'Weekly grounds maintenance', type: 'recurring', recurrence: 'weekly', price: 240, startOffset: -84 },
  { customerIdx: 9, title: 'Biweekly mowing', type: 'recurring', recurrence: 'biweekly', price: 180, startOffset: -84 },
  // One-time projects, scattered around recent weeks
  { customerIdx: 0, title: 'Spring cleanup', type: 'single', price: 220, dateOffset: -55 },
  { customerIdx: 4, title: 'Gutter cleaning', type: 'single', price: 165, dateOffset: -30 },
  { customerIdx: 2, title: 'Hedge trim',     type: 'single', price: 140, dateOffset: -14 },
  { customerIdx: 6, title: 'Mulch refresh',  type: 'single', price: 320, dateOffset:  7  },
];

function recurringDates(startOffsetDays, recurrence) {
  // Produce every visit date between startOffset days ago and ~14 days
  // ahead. Recurrence pattern picks the cadence.
  const out = [];
  const step = recurrence === 'biweekly' ? 14 : recurrence === 'monthly' ? 30 : 7;
  for (let day = startOffsetDays; day <= 14; day += step) out.push(day);
  return out;
}

async function populateDemoOrg(client, orgId, userId) {
  // Customers
  const customerIds = [];
  for (let i = 0; i < CUSTOMERS.length; i++) {
    const c = CUSTOMERS[i];
    const id = uuid();
    customerIds.push(id);
    const createdAt = daysAgo(90 - i * 3);
    await client.query(
      `INSERT INTO customers
         (id, organization_id, first_name, last_name, business_name, phone, email, address, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
      [id, orgId, c.first || null, c.last || null, c.business || null, c.phone, null, c.address, c.notes, createdAt]
    );
  }

  // Jobs + their past completions
  const jobs = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = yyyymmdd(today);

  for (const tmpl of JOB_TEMPLATES) {
    const id = uuid();
    const customer_id = customerIds[tmpl.customerIdx];
    const isSingle = tmpl.type === 'single';
    let date = null, start_date = null, end_date = null, recurrence_pattern = null;
    let completedDates = [];
    let completionNotes = [];

    if (isSingle) {
      const visitDate = yyyymmdd(daysFromNow(tmpl.dateOffset));
      date = visitDate;
      if (tmpl.dateOffset < 0) {
        completedDates = [visitDate];
        completionNotes = [{
          date: visitDate, note: null,
          completedBy: userId,
          completedByName: 'Demo User',
          completedAt: daysFromNow(tmpl.dateOffset).toISOString(),
        }];
      }
    } else {
      start_date = yyyymmdd(daysFromNow(tmpl.startOffset));
      recurrence_pattern = tmpl.recurrence;
      const visits = recurringDates(tmpl.startOffset, tmpl.recurrence);
      for (const offset of visits) {
        if (offset > 0) continue; // future visits don't get completion entries
        const visitStr = yyyymmdd(daysFromNow(offset));
        completedDates.push(visitStr);
        completionNotes.push({
          date: visitStr, note: null,
          completedBy: userId,
          completedByName: 'Demo User',
          completedAt: daysFromNow(offset).toISOString(),
        });
      }
    }

    const createdAt = daysAgo(95);
    const status = isSingle && tmpl.dateOffset < 0 ? 'completed' : 'scheduled';

    await client.query(
      `INSERT INTO jobs
         (id, organization_id, customer_id, assigned_to, title, description, type,
          date, start_date, end_date, recurrence_pattern, default_price, status,
          completed_dates, skipped_dates, rescheduled_dates, deleted_dates, completion_notes,
          billed_dates,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7,
               $8, $9, $10, $11, $12, $13,
               $14::jsonb, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, $15::jsonb,
               '[]'::jsonb,
               $16, $16)`,
      [
        id, orgId, customer_id, JSON.stringify([userId]),
        tmpl.title, null, isSingle ? 'single' : 'recurring',
        date, start_date, end_date, recurrence_pattern,
        tmpl.price, status,
        JSON.stringify(completedDates),
        JSON.stringify(completionNotes),
        createdAt,
      ]
    );
    jobs.push({ id, customer_id, title: tmpl.title, price: tmpl.price, completedDates });
  }

  // Invoices — bump the org's invoice number counter as we go.
  let nextNumberRow = await client.query(
    `SELECT next_invoice_number FROM organizations WHERE id = $1`, [orgId]
  );
  let nextNumber = nextNumberRow.rows[0]?.next_invoice_number || 1001;

  async function insertInvoice({ customer_id, status, daysAgoIssued, daysAgoPaid, lineItems, description }) {
    const id = uuid();
    const date = yyyymmdd(daysAgo(daysAgoIssued));
    const sentDate = status === 'draft' ? null : daysAgo(daysAgoIssued).toISOString();
    const paidDate = status === 'paid' ? daysAgo(daysAgoPaid).toISOString() : null;
    const invoiceNumber = nextNumber++;
    await client.query(
      `INSERT INTO invoices
         (id, organization_id, customer_id, invoice_number, status, description,
          date, sent_date, paid_date, line_items,
          discount_type, discount_value, tax_rate,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6,
               $7::date, $8::timestamptz, $9::timestamptz, $10::jsonb,
               NULL, 0, 0,
               $11, $11)`,
      [id, orgId, customer_id, invoiceNumber, status, description, date, sentDate, paidDate, JSON.stringify(lineItems), daysAgo(daysAgoIssued)]
    );
  }

  function lineItemsFor(job, count) {
    const items = [];
    const dates = job.completedDates.slice(-count);
    for (const d of dates) {
      items.push({
        description: `${job.title} — ${d}`,
        quantity: 1, rate: job.price, amount: job.price,
        date: d,
      });
    }
    return items;
  }

  // Past paid invoices, spread across the last 8 weeks
  await insertInvoice({
    customer_id: jobs[0].customer_id, status: 'paid',
    daysAgoIssued: 60, daysAgoPaid: 52,
    description: 'April mowing',
    lineItems: lineItemsFor(jobs[0], 4),
  });
  await insertInvoice({
    customer_id: jobs[1].customer_id, status: 'paid',
    daysAgoIssued: 45, daysAgoPaid: 38,
    description: 'April mowing',
    lineItems: lineItemsFor(jobs[1], 4),
  });
  await insertInvoice({
    customer_id: jobs[2].customer_id, status: 'paid',
    daysAgoIssued: 30, daysAgoPaid: 24,
    description: 'May mowing',
    lineItems: lineItemsFor(jobs[2], 4),
  });
  await insertInvoice({
    customer_id: jobs[4].customer_id, status: 'paid',
    daysAgoIssued: 15, daysAgoPaid: 10,
    description: 'Recent mowing',
    lineItems: lineItemsFor(jobs[4], 3),
  });
  // Sent (outstanding)
  await insertInvoice({
    customer_id: jobs[8].customer_id, status: 'sent',
    daysAgoIssued: 7, daysAgoPaid: null,
    description: 'May grounds maintenance',
    lineItems: lineItemsFor(jobs[8], 4),
  });
  await insertInvoice({
    customer_id: jobs[5].customer_id, status: 'sent',
    daysAgoIssued: 4, daysAgoPaid: null,
    description: 'May mowing',
    lineItems: lineItemsFor(jobs[5], 2),
  });
  // Drafts
  await insertInvoice({
    customer_id: jobs[6].customer_id, status: 'draft',
    daysAgoIssued: 2, daysAgoPaid: null,
    description: null,
    lineItems: lineItemsFor(jobs[6], 3),
  });
  await insertInvoice({
    customer_id: jobs[7].customer_id, status: 'draft',
    daysAgoIssued: 1, daysAgoPaid: null,
    description: null,
    lineItems: lineItemsFor(jobs[7], 3),
  });

  await client.query(
    `UPDATE organizations SET next_invoice_number = $2 WHERE id = $1`,
    [orgId, nextNumber]
  );

  // Quotes — pending, accepted, declined
  async function insertQuote({ customer_id, status, daysAgoCreated, lineItems, description, notes }) {
    const id = uuid();
    await client.query(
      `INSERT INTO quotes
         (id, organization_id, customer_id, description, notes, line_items, status,
          prospect_name, prospect_email, prospect_phone, prospect_address,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7,
               NULL, NULL, NULL, NULL,
               $8, $8)`,
      [id, orgId, customer_id, description, notes, JSON.stringify(lineItems), status, daysAgo(daysAgoCreated)]
    );
  }
  await insertQuote({
    customer_id: customerIds[7], status: 'pending', daysAgoCreated: 3,
    description: 'Quarterly cleanup proposal',
    notes: 'Mulch + edging + bed cleanup',
    lineItems: [
      { description: 'Bed cleanup + edging', quantity: 1, rate: 320, amount: 320 },
      { description: 'Hardwood mulch (3 yd)', quantity: 1, rate: 285, amount: 285 },
    ],
  });
  await insertQuote({
    customer_id: customerIds[9], status: 'accepted', daysAgoCreated: 21,
    description: 'Annual grounds contract',
    notes: 'Mar 15 – Nov 15. Biweekly mowing, spring + fall cleanup.',
    lineItems: [
      { description: 'Annual mowing contract', quantity: 1, rate: 2400, amount: 2400 },
      { description: 'Spring cleanup', quantity: 1, rate: 480, amount: 480 },
      { description: 'Fall cleanup', quantity: 1, rate: 480, amount: 480 },
    ],
  });
  await insertQuote({
    customer_id: customerIds[3], status: 'declined', daysAgoCreated: 12,
    description: 'Lawn aeration + overseed',
    notes: 'Customer went with a different vendor.',
    lineItems: [
      { description: 'Core aeration', quantity: 1, rate: 195, amount: 195 },
      { description: 'Overseed (cool-season blend)', quantity: 1, rate: 220, amount: 220 },
    ],
  });
}

module.exports = { populateDemoOrg };
