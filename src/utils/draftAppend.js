// Append a single completion to the customer's open draft invoice (or
// start a new draft if there isn't one). Also marks the date as billed
// on the job so the scheduled auto-invoice rollup will skip it.
//
// Idempotent: if an existing draft already contains a line item with the
// same { job_id, date } source tag, no second line is added.
//
// All caller-facing functions accept a pg client so the caller can wrap
// them in their own transaction.

async function findOpenDraftForCustomer(client, { orgId, customerId }) {
  const { rows } = await client.query(
    `SELECT id, line_items
     FROM invoices
     WHERE organization_id = $1 AND customer_id = $2 AND status = 'draft'
     ORDER BY created_at DESC
     LIMIT 1`,
    [orgId, customerId]
  );
  return rows[0] || null;
}

function hasMatchingLine(lineItems, jobId, date) {
  if (!Array.isArray(lineItems)) return false;
  return lineItems.some((li) => li && li.source
    && li.source.job_id === jobId
    && li.source.date === date);
}

function buildLine({ jobTitle, date, rate, jobId }) {
  const numericRate = Number(rate) || 0;
  return {
    description: `${jobTitle} — ${date}`,
    quantity: 1,
    rate: numericRate,
    amount: numericRate,
    source: { job_id: jobId, date },
  };
}

async function appendCompletionToDraft(client, { orgId, jobId, customerId, jobTitle, rate, date }) {
  const draft = await findOpenDraftForCustomer(client, { orgId, customerId });
  const line = buildLine({ jobTitle, date, rate, jobId });

  if (draft) {
    if (hasMatchingLine(draft.line_items, jobId, date)) return draft.id;
    const next = [...(Array.isArray(draft.line_items) ? draft.line_items : []), line];
    await client.query(
      `UPDATE invoices SET line_items = $2::jsonb, updated_at = NOW() WHERE id = $1`,
      [draft.id, JSON.stringify(next)]
    );
    return draft.id;
  }

  // No open draft — create one.
  const bumped = await client.query(
    `UPDATE organizations
     SET next_invoice_number = next_invoice_number + 1
     WHERE id = $1
     RETURNING next_invoice_number - 1 AS invoice_number`,
    [orgId]
  );
  const invoiceNumber = bumped.rows[0].invoice_number;
  const inserted = await client.query(
    `INSERT INTO invoices
      (organization_id, customer_id, invoice_number, status, description, date, line_items)
     VALUES ($1, $2, $3, 'draft', NULL, CURRENT_DATE, $4::jsonb)
     RETURNING id`,
    [orgId, customerId, invoiceNumber, JSON.stringify([line])]
  );
  return inserted.rows[0].id;
}

// Reverse of append. Pulls the matching { job_id, date } line out of the
// customer's open draft. If the draft has no remaining line items, the
// draft itself is removed. Only touches DRAFT invoices — anything already
// sent or paid is left alone (the caller will need to credit it manually).
//
// Returns: { removed: boolean, invoiceId?: string, deletedInvoice?: boolean }
async function removeCompletionFromDraft(client, { orgId, jobId, customerId, date }) {
  const draft = await findOpenDraftForCustomer(client, { orgId, customerId });
  if (!draft) return { removed: false };
  const lineItems = Array.isArray(draft.line_items) ? draft.line_items : [];
  const idx = lineItems.findIndex((li) => li && li.source
    && li.source.job_id === jobId
    && li.source.date === date);
  if (idx === -1) return { removed: false };

  const next = lineItems.slice(0, idx).concat(lineItems.slice(idx + 1));
  if (next.length === 0) {
    await client.query(`DELETE FROM invoices WHERE id = $1`, [draft.id]);
    return { removed: true, invoiceId: draft.id, deletedInvoice: true };
  }
  await client.query(
    `UPDATE invoices SET line_items = $2::jsonb, updated_at = NOW() WHERE id = $1`,
    [draft.id, JSON.stringify(next)]
  );
  return { removed: true, invoiceId: draft.id, deletedInvoice: false };
}

async function isAutoAppendEnabled(client, orgId) {
  const { rows } = await client.query(
    `SELECT auto_append_to_draft FROM organization_settings WHERE organization_id = $1 LIMIT 1`,
    [orgId]
  );
  return !!(rows[0] && rows[0].auto_append_to_draft);
}

module.exports = {
  appendCompletionToDraft,
  removeCompletionFromDraft,
  isAutoAppendEnabled,
};
