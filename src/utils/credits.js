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

module.exports = { round2, creditBalance, invoiceTotal };
