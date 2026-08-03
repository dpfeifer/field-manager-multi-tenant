// Prepaid customer credit. The ledger (customer_credits) is the source of
// truth: available credit = SUM(amount) over a customer's non-deleted rows.
// Positive rows add credit; negative rows apply it to an invoice.

// Money helper — credit math must not drift on floating point.
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

async function creditBalance(client, orgId, customerId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS balance
     FROM customer_credits
     WHERE organization_id = $1 AND customer_id = $2 AND deleted_at IS NULL`,
    [orgId, customerId]
  );
  return round2(rows[0].balance);
}

// Total an invoice is worth before any credit (line items - discount + tax).
function invoiceTotal(inv) {
  const subtotal = (inv.line_items || []).reduce((s, li) => s + (parseFloat(li.amount) || 0), 0);
  let discount = 0;
  const dv = parseFloat(inv.discount_value) || 0;
  if (dv > 0 && (inv.discount_type === 'percent' || inv.discount_type === 'amount')) {
    discount = inv.discount_type === 'percent' ? subtotal * dv / 100 : dv;
  }
  const discounted = Math.max(0, subtotal - discount);
  const tax = discounted * (parseFloat(inv.tax_rate) || 0) / 100;
  return round2(discounted + tax);
}

// Give back any credit applied to an invoice: soft-delete the ledger rows that
// consumed it (restoring the customer's balance) and zero the invoice's
// credit_applied. Used when an invoice is deleted or marked unpaid — otherwise
// the credit stays spent on an invoice that no longer owes anything.
// Returns the amount released. Caller supplies a transaction client.
async function releaseInvoiceCredit(client, orgId, invoiceId) {
  const { rows } = await client.query(
    `UPDATE customer_credits SET deleted_at = NOW()
     WHERE organization_id = $1 AND invoice_id = $2 AND deleted_at IS NULL
     RETURNING amount`,
    [orgId, invoiceId]
  );
  if (rows.length === 0) return 0;
  await client.query(
    `UPDATE invoices SET credit_applied = 0, updated_at = NOW()
     WHERE id = $1 AND organization_id = $2`,
    [invoiceId, orgId]
  );
  return round2(rows.reduce((s, r) => s + Math.abs(parseFloat(r.amount) || 0), 0));
}

module.exports = { round2, creditBalance, invoiceTotal, releaseInvoiceCredit };
