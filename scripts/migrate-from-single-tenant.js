#!/usr/bin/env node
//
// One-time migration: single-tenant Field Manager → multi-tenant.
//
// Required env:
//   SOURCE_DATABASE_URL   Postgres URL for the single-tenant DB
//   TARGET_DATABASE_URL   Postgres URL for the multi-tenant DB
//   TARGET_ORG_SLUG       Slug of the destination organization (must already exist and be empty)
//
// Optional env:
//   DRY_RUN=true          Read source, report counts, do not write to target
//   SOURCE_SSL=true|false Override SSL for source (default: on unless localhost)
//   TARGET_SSL=true|false Override SSL for target (default: on unless localhost)
//
// What's migrated (with organization_id added):
//   customers  → customers
//   jobs       → jobs
//   invoices   → invoices  (invoice_number preserved; advances target next_invoice_number)
//   quotes    → quotes
//
// What's skipped:
//   users               recreate via signup + Team tab; password hashes don't transfer
//   push_subscriptions  browser-specific; users re-subscribe
//   app_settings        not a clean mapping; set org branding via Settings page
//
// Behavior:
//   - Aborts if target org doesn't exist or already has any rows (customers/jobs/invoices/quotes)
//   - Preserves UUIDs across the migration so foreign keys (customer_id, etc.) stay intact
//   - Writes in dependency order: customers → jobs/invoices/quotes
//   - Each table is inserted in a single transaction for atomicity per-table
//
// Usage:
//   SOURCE_DATABASE_URL=postgres://... \
//   TARGET_DATABASE_URL=postgres://... \
//   TARGET_ORG_SLUG=ampd \
//   node scripts/migrate-from-single-tenant.js
//

const { Pool } = require('pg');

function makePool(url, sslOverride) {
  const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
  let ssl;
  if (sslOverride === 'true') ssl = { rejectUnauthorized: false };
  else if (sslOverride === 'false') ssl = false;
  else ssl = isLocal ? false : { rejectUnauthorized: false };
  return new Pool({ connectionString: url, ssl });
}

function asJsonb(v) {
  if (v === null || v === undefined) return null;
  return JSON.stringify(v);
}

function normalizeDate(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function normalizeJobType(t) {
  return t === 'recurring' ? 'recurring' : 'single';
}

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  const targetUrl = process.env.TARGET_DATABASE_URL;
  const slug = (process.env.TARGET_ORG_SLUG || '').trim().toLowerCase();
  const dryRun = process.env.DRY_RUN === 'true';

  if (!sourceUrl || !targetUrl || !slug) {
    console.error('Required env: SOURCE_DATABASE_URL, TARGET_DATABASE_URL, TARGET_ORG_SLUG');
    process.exit(1);
  }

  const source = makePool(sourceUrl, process.env.SOURCE_SSL);
  const target = makePool(targetUrl, process.env.TARGET_SSL);

  console.log(`\nField Manager migration — single-tenant → multi-tenant`);
  console.log(`  Target org slug: ${slug}`);
  console.log(`  Dry run: ${dryRun ? 'YES (nothing will be written)' : 'no'}\n`);

  try {
    await source.query('SELECT 1');
    await target.query('SELECT 1');

    const orgRes = await target.query(
      'SELECT id, name FROM organizations WHERE slug = $1 AND deleted_at IS NULL LIMIT 1',
      [slug]
    );
    if (orgRes.rows.length === 0) {
      throw new Error(`Target organization with slug "${slug}" does not exist. Sign up the org in the multi-tenant app first.`);
    }
    const orgId = orgRes.rows[0].id;
    console.log(`Target org found: ${orgRes.rows[0].name} (${orgId})`);

    const existing = await target.query(
      `SELECT
         (SELECT COUNT(*)::int FROM customers WHERE organization_id = $1 AND deleted_at IS NULL) AS customers,
         (SELECT COUNT(*)::int FROM jobs WHERE organization_id = $1 AND deleted_at IS NULL) AS jobs,
         (SELECT COUNT(*)::int FROM invoices WHERE organization_id = $1 AND deleted_at IS NULL) AS invoices,
         (SELECT COUNT(*)::int FROM quotes WHERE organization_id = $1 AND deleted_at IS NULL) AS quotes`,
      [orgId]
    );
    const counts = existing.rows[0];
    const nonZero = Object.entries(counts).filter(([, n]) => n > 0);
    if (nonZero.length > 0) {
      throw new Error(`Target org is not empty: ${nonZero.map(([k, n]) => `${n} ${k}`).join(', ')}. Migrate to a fresh org or clear these tables first.`);
    }
    console.log('Target org is empty — proceeding.\n');

    const customers = (await source.query('SELECT * FROM customers ORDER BY created_at')).rows;
    const jobs = (await source.query('SELECT * FROM jobs ORDER BY created_at')).rows;
    const invoices = (await source.query('SELECT * FROM invoices ORDER BY created_at')).rows;
    const quotes = (await source.query('SELECT * FROM quotes ORDER BY created_at')).rows;

    console.log(`Source row counts:`);
    console.log(`  customers: ${customers.length}`);
    console.log(`  jobs:      ${jobs.length}`);
    console.log(`  invoices:  ${invoices.length}`);
    console.log(`  quotes:    ${quotes.length}\n`);

    if (dryRun) {
      console.log('DRY_RUN=true — exiting without writing.');
      return;
    }

    const client = await target.connect();
    try {
      await client.query('BEGIN');

      for (const c of customers) {
        await client.query(
          `INSERT INTO customers
            (id, organization_id, first_name, last_name, business_name, phone, email, address, notes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
          [c.id, orgId, c.first_name, c.last_name, c.business_name, c.phone, c.email, c.address, c.notes, c.created_at]
        );
      }
      console.log(`Inserted ${customers.length} customers`);

      for (const j of jobs) {
        await client.query(
          `INSERT INTO jobs
            (id, organization_id, customer_id, assigned_to, title, description, type,
             date, start_date, end_date, recurrence_pattern, default_price, status,
             completed_dates, skipped_dates, rescheduled_dates, deleted_dates, completion_notes,
             created_at, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7,
                   $8, $9, $10, $11, $12, $13,
                   $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb, $18::jsonb,
                   $19, $19)`,
          [
            j.id, orgId, j.customer_id,
            asJsonb(j.assigned_to ?? []),
            j.title || 'Untitled',
            j.description, normalizeJobType(j.type),
            normalizeDate(j.date), normalizeDate(j.start_date), normalizeDate(j.end_date),
            j.recurrence_pattern || 'weekly',
            j.default_price ?? 0, j.status || 'scheduled',
            asJsonb(j.completed_dates ?? []),
            asJsonb(j.skipped_dates ?? []),
            asJsonb(j.rescheduled_dates ?? {}),
            asJsonb(j.deleted_dates ?? []),
            asJsonb(j.completion_notes ?? []),
            j.created_at,
          ]
        );
      }
      console.log(`Inserted ${jobs.length} jobs`);

      for (const i of invoices) {
        await client.query(
          `INSERT INTO invoices
            (id, organization_id, customer_id, invoice_number, status, description,
             date, sent_date, paid_date, line_items,
             discount_type, discount_value, tax_rate,
             created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6,
                   COALESCE($7::date, CURRENT_DATE), $8::timestamptz, $9::timestamptz, $10::jsonb,
                   NULL, 0, 0,
                   $11, $11)`,
          [
            i.id, orgId, i.customer_id, i.invoice_number, i.status || 'draft', i.description,
            normalizeDate(i.date),
            normalizeDate(i.sent_date), normalizeDate(i.paid_date),
            asJsonb(i.line_items ?? []),
            i.created_at,
          ]
        );
      }
      console.log(`Inserted ${invoices.length} invoices`);

      for (const q of quotes) {
        await client.query(
          `INSERT INTO quotes
            (id, organization_id, customer_id, description, notes, line_items, status,
             prospect_name, prospect_email, prospect_phone, prospect_address,
             created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7,
                   $8, $9, $10, $11,
                   $12, $12)`,
          [
            q.id, orgId, q.customer_id, q.description, q.notes,
            asJsonb(q.line_items ?? []),
            q.status || 'draft',
            q.prospect_name, q.prospect_email, q.prospect_phone, q.prospect_address,
            q.created_at,
          ]
        );
      }
      console.log(`Inserted ${quotes.length} quotes`);

      const maxInv = invoices.reduce((m, i) => Math.max(m, parseInt(i.invoice_number, 10) || 0), 0);
      if (maxInv > 0) {
        await client.query(
          `UPDATE organizations
           SET next_invoice_number = GREATEST(next_invoice_number, $2 + 1)
           WHERE id = $1`,
          [orgId, maxInv]
        );
        console.log(`Advanced next_invoice_number past ${maxInv}`);
      }

      await client.query('COMMIT');
      console.log('\nMigration committed.');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((err) => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});
