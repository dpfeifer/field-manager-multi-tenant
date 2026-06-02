function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function appUrl(orgSlug) {
  const base = process.env.APP_URL || 'https://fieldmgr.com';
  return orgSlug ? `${base}` : base;
}

function moneyUSD(n) {
  const v = parseFloat(n);
  if (!isFinite(v)) return '$0.00';
  return '$' + v.toFixed(2);
}

function shellHTML({ heading, bodyHtml, footerHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0; padding:0; background:#faf8f4; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#2d2a26;">
  <div style="max-width:600px; margin:40px auto; background:#ffffff; border-radius:12px; padding:40px; box-shadow:0 4px 14px rgba(45,42,38,0.06);">
    <h1 style="margin:0 0 8px; font-size:20px; letter-spacing:-0.01em;">${escapeHtml(heading)}</h1>
    ${bodyHtml}
  </div>
  <div style="max-width:600px; margin:24px auto; text-align:center; color:#6d6a64; font-size:12px;">
    ${footerHtml || ''}
  </div>
</body>
</html>`;
}

function invoiceTemplate({ invoice, org, settings, total, subtotal, discount, tax }) {
  const companyName = settings.company_name || org.name;
  const customerLabel = settings.customer_label || 'Customer';
  const customerName = (invoice.customer_business_name) ||
    [invoice.customer_first_name, invoice.customer_last_name].filter(Boolean).join(' ') ||
    customerLabel;
  const invoiceUrl = `${process.env.APP_URL || 'https://fieldmgr.com'}/i/${invoice.id}`;
  const venmo = settings.venmo_handle && invoice.status !== 'paid'
    ? `<p style="margin:16px 0 0;"><strong>Pay via Venmo:</strong> @${escapeHtml(settings.venmo_handle)}</p>`
    : '';
  const lineItemsHtml = (invoice.line_items || []).map(li => `
    <tr>
      <td style="padding:8px 0; border-bottom:1px solid #ece6d8;">${escapeHtml(li.description || '')}</td>
      <td style="padding:8px 0; border-bottom:1px solid #ece6d8; text-align:right;">${li.quantity || 0}</td>
      <td style="padding:8px 0; border-bottom:1px solid #ece6d8; text-align:right;">${moneyUSD(li.amount)}</td>
    </tr>`).join('');

  const bodyHtml = `
    <p style="margin:0 0 8px; color:#6d6a64; font-size:14px;">Invoice from ${escapeHtml(companyName)}</p>
    <p style="margin:0 0 24px; color:#6d6a64; font-size:14px;">Hi ${escapeHtml(customerName)}, here's your invoice. The full version is available at the link below — you can also save or print it.</p>

    <table style="width:100%; border-collapse:collapse; margin:16px 0;">
      <thead><tr>
        <th style="text-align:left; font-size:11px; text-transform:uppercase; color:#6d6a64; letter-spacing:0.06em; padding-bottom:6px;">Item</th>
        <th style="text-align:right; font-size:11px; text-transform:uppercase; color:#6d6a64; letter-spacing:0.06em; padding-bottom:6px;">Qty</th>
        <th style="text-align:right; font-size:11px; text-transform:uppercase; color:#6d6a64; letter-spacing:0.06em; padding-bottom:6px;">Amount</th>
      </tr></thead>
      <tbody>${lineItemsHtml}</tbody>
    </table>

    ${discount > 0 ? `<p style="margin:8px 0; color:#6d6a64; text-align:right; font-size:14px;">Discount: −${moneyUSD(discount)}</p>` : ''}
    ${tax > 0 ? `<p style="margin:8px 0; color:#6d6a64; text-align:right; font-size:14px;">Tax: ${moneyUSD(tax)}</p>` : ''}
    <p style="margin:16px 0; text-align:right; font-size:18px; font-weight:600;">Total: ${moneyUSD(total)}</p>

    ${invoice.description ? `<p style="margin:24px 0 8px; color:#2d2a26;">${escapeHtml(invoice.description)}</p>` : ''}

    <div style="margin-top:24px;">
      <a href="${invoiceUrl}" style="display:inline-block; background:#4a5e7a; color:#ffffff; text-decoration:none; padding:11px 18px; border-radius:8px; font-weight:600; font-size:14px;">View full invoice</a>
    </div>

    ${venmo}
  `;

  const footerHtml = `
    ${escapeHtml(companyName)}${settings.address ? `<br/>${escapeHtml(settings.address)}` : ''}<br/>
    ${settings.phone ? escapeHtml(settings.phone) + ' · ' : ''}${settings.email ? escapeHtml(settings.email) : ''}
  `;

  const html = shellHTML({
    heading: `Invoice #${invoice.invoice_number} — ${moneyUSD(total)}`,
    bodyHtml,
    footerHtml,
  });

  const text = `${companyName}\n\nInvoice #${invoice.invoice_number}\nTotal: ${moneyUSD(total)}\n\nView the full invoice: ${invoiceUrl}\n${settings.venmo_handle && invoice.status !== 'paid' ? `\nPay via Venmo: @${settings.venmo_handle}\n` : ''}`;

  return {
    subject: `Invoice #${invoice.invoice_number} from ${companyName} — ${moneyUSD(total)}`,
    html,
    text,
  };
}

function quoteTemplate({ quote, org, settings, total, recipientName }) {
  const companyName = settings.company_name || org.name;
  const bodyHtml = `
    <p style="margin:0 0 8px; color:#6d6a64; font-size:14px;">Estimate from ${escapeHtml(companyName)}</p>
    <p style="margin:0 0 24px; color:#6d6a64; font-size:14px;">Hi ${escapeHtml(recipientName || 'there')}, here's the quote we discussed.</p>

    ${quote.description ? `<p style="margin:8px 0 16px;"><strong>${escapeHtml(quote.description)}</strong></p>` : ''}

    <table style="width:100%; border-collapse:collapse; margin:16px 0;">
      <thead><tr>
        <th style="text-align:left; font-size:11px; text-transform:uppercase; color:#6d6a64; letter-spacing:0.06em; padding-bottom:6px;">Item</th>
        <th style="text-align:right; font-size:11px; text-transform:uppercase; color:#6d6a64; letter-spacing:0.06em; padding-bottom:6px;">Qty</th>
        <th style="text-align:right; font-size:11px; text-transform:uppercase; color:#6d6a64; letter-spacing:0.06em; padding-bottom:6px;">Amount</th>
      </tr></thead>
      <tbody>${(quote.line_items || []).map(li => `
        <tr>
          <td style="padding:8px 0; border-bottom:1px solid #ece6d8;">${escapeHtml(li.description || '')}</td>
          <td style="padding:8px 0; border-bottom:1px solid #ece6d8; text-align:right;">${li.quantity || 0}</td>
          <td style="padding:8px 0; border-bottom:1px solid #ece6d8; text-align:right;">${moneyUSD(li.amount)}</td>
        </tr>`).join('')}
      </tbody>
    </table>

    <p style="margin:16px 0; text-align:right; font-size:18px; font-weight:600;">Estimated total: ${moneyUSD(total)}</p>

    ${quote.notes ? `<p style="margin:24px 0; color:#6d6a64; font-size:14px; white-space:pre-line;">${escapeHtml(quote.notes)}</p>` : ''}

    <p style="margin:24px 0 0; color:#6d6a64; font-size:14px;">Reply to this email to accept the quote or ask questions.</p>
  `;
  const footerHtml = `
    ${escapeHtml(companyName)}${settings.address ? `<br/>${escapeHtml(settings.address)}` : ''}<br/>
    ${settings.phone ? escapeHtml(settings.phone) + ' · ' : ''}${settings.email ? escapeHtml(settings.email) : ''}
  `;
  const html = shellHTML({ heading: `Quote from ${companyName} — ${moneyUSD(total)}`, bodyHtml, footerHtml });
  const text = `${companyName}\n\n${quote.description ? quote.description + '\n\n' : ''}Estimated total: ${moneyUSD(total)}\n\nReply to this email to accept or ask questions.\n`;
  return { subject: `Quote from ${companyName} — ${moneyUSD(total)}`, html, text };
}

function teamInviteTemplate({ inviteeName, inviterName, orgName, setupUrl, role }) {
  const greeting = inviteeName ? `Hi ${escapeHtml(inviteeName)},` : 'Hi there,';
  const inviter = inviterName ? escapeHtml(inviterName) : 'A teammate';
  const roleLabel = { admin: 'an admin', lead: 'a lead', employee: 'an employee' }[role] || 'a team member';
  const bodyHtml = `
    <p style="margin:0 0 12px; color:#6d6a64; font-size:14px;">${greeting}</p>
    <p style="margin:0 0 12px; color:#6d6a64; font-size:14px;">${inviter} added you to <strong>${escapeHtml(orgName)}</strong> on Field Manager as ${roleLabel}.</p>
    <p style="margin:0 0 24px; color:#6d6a64; font-size:14px;">Click below to set your password and sign in. The link expires in 7 days.</p>
    <a href="${setupUrl}" style="display:inline-block; background:#4a5e7a; color:#ffffff; text-decoration:none; padding:11px 18px; border-radius:8px; font-weight:600; font-size:14px;">Set your password</a>
    <p style="margin:24px 0 0; color:#6d6a64; font-size:12px;">If you weren't expecting this invite, you can safely ignore this email.</p>
  `;
  const heading = `You're invited to ${orgName}`;
  const html = shellHTML({ heading, bodyHtml });
  const text = `${inviter} added you to ${orgName} on Field Manager as ${roleLabel}. Set your password (link expires in 7 days):\n\n${setupUrl}`;
  return { subject: `You're invited to ${orgName} on Field Manager`, html, text };
}

function passwordResetTemplate({ user, orgSlug, resetUrl }) {
  const bodyHtml = `
    <p style="margin:0 0 12px; color:#6d6a64; font-size:14px;">Someone (hopefully you) requested a password reset for your Field Manager account.</p>
    <p style="margin:0 0 24px; color:#6d6a64; font-size:14px;">Click below to set a new password. The link expires in 1 hour.</p>
    <a href="${resetUrl}" style="display:inline-block; background:#4a5e7a; color:#ffffff; text-decoration:none; padding:11px 18px; border-radius:8px; font-weight:600; font-size:14px;">Reset your password</a>
    <p style="margin:24px 0 0; color:#6d6a64; font-size:12px;">If you didn't request this, you can safely ignore this email.</p>
  `;
  const html = shellHTML({ heading: 'Reset your Field Manager password', bodyHtml });
  const text = `Reset your Field Manager password by visiting this link (expires in 1 hour):\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`;
  return { subject: 'Reset your Field Manager password', html, text };
}

// Editable template renderer (uses templateStore + substitution).
// Wraps the customizable intro in the standard shell with a CTA button.
function renderEditableTemplate(template, vars, { ctaLabel, ctaUrl, heading }) {
  const subject = (require('./templateStore').substitute(template.subject, vars));
  const introHtml = require('./templateStore').substitute(template.intro_html, vars);
  const introText = require('./templateStore').substitute(template.intro_text, vars);
  const cta = ctaUrl
    ? `<div style="margin:24px 0 0;">
         <a href="${ctaUrl}" style="display:inline-block; background:#4a5e7a; color:#ffffff; text-decoration:none; padding:11px 18px; border-radius:8px; font-weight:600; font-size:14px;">${escapeHtml(ctaLabel || 'Continue')}</a>
       </div>`
    : '';
  const bodyHtml = `${introHtml}${cta}`;
  const html = shellHTML({ heading: heading || subject, bodyHtml });
  return { subject, html, text: introText };
}

module.exports = { invoiceTemplate, quoteTemplate, passwordResetTemplate, teamInviteTemplate, renderEditableTemplate };
