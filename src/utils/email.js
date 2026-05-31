const { Resend } = require('resend');

let cachedClient = null;
function client() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!cachedClient) cachedClient = new Resend(process.env.RESEND_API_KEY);
  return cachedClient;
}

async function sendEmail({ to, subject, html, text, replyTo }) {
  const from = process.env.EMAIL_FROM || '"Field Manager" <hello@fieldmgr.com>';
  const c = client();
  if (!c) {
    console.warn('sendEmail skipped: RESEND_API_KEY is not set');
    return { sent: false, reason: 'not_configured' };
  }
  try {
    const result = await c.emails.send({
      from,
      to,
      subject,
      html,
      text,
      replyTo,
    });
    if (result.error) {
      console.error('Resend error:', result.error);
      return { sent: false, reason: 'resend_error', error: result.error.message || String(result.error) };
    }
    return { sent: true, id: result.data && result.data.id };
  } catch (err) {
    console.error('sendEmail threw:', err);
    return { sent: false, reason: 'exception', error: err.message };
  }
}

module.exports = { sendEmail };
