const express = require('express');
const { query } = require('../config/db');
const { sendEmail } = require('../utils/email');

const router = express.Router();

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// List recent team messages with this user's read state.
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT m.id, m.subject, m.body, m.created_at,
              m.author_user_id,
              u.name AS author_name, u.email AS author_email,
              (r.read_at IS NOT NULL) AS is_read
       FROM team_messages m
       JOIN users u ON u.id = m.author_user_id
       LEFT JOIN team_message_reads r
         ON r.message_id = m.id AND r.user_id = $1
       WHERE m.organization_id = $2
       ORDER BY m.created_at DESC
       LIMIT 50`,
      [req.user.sub, req.organization.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// Lightweight badge endpoint — number of unread messages not authored by
// the current user.
router.get('/unread/count', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS count
       FROM team_messages m
       LEFT JOIN team_message_reads r
         ON r.message_id = m.id AND r.user_id = $1
       WHERE m.organization_id = $2
         AND m.author_user_id <> $1
         AND r.read_at IS NULL`,
      [req.user.sub, req.organization.id]
    );
    res.json({ count: rows[0].count });
  } catch (err) { next(err); }
});

// Send a team note. Any team member can post.
router.post('/', async (req, res, next) => {
  const body = req.body || {};
  const subject = String(body.subject || '').trim().slice(0, 200) || null;
  const message = String(body.body || '').trim().slice(0, 5000);

  if (!message) return res.status(400).json({ error: 'Message body is required' });

  try {
    const inserted = await query(
      `INSERT INTO team_messages (organization_id, author_user_id, subject, body)
       VALUES ($1, $2, $3, $4)
       RETURNING id, subject, body, created_at, author_user_id`,
      [req.organization.id, req.user.sub, subject, message]
    );
    const note = inserted.rows[0];

    // Best-effort: email every active teammate other than the author.
    (async () => {
      try {
        const authorRow = await query(
          `SELECT u.name, u.email, o.name AS org_name, s.company_name
           FROM users u
           JOIN organizations o ON o.id = u.organization_id
           LEFT JOIN organization_settings s ON s.organization_id = u.organization_id
           WHERE u.id = $1
           LIMIT 1`,
          [req.user.sub]
        );
        const a = authorRow.rows[0] || {};
        const senderName = a.name || a.email || 'A teammate';
        const orgDisplay = a.company_name || a.org_name || 'your team';

        const recipients = await query(
          `SELECT email, name FROM users
           WHERE organization_id = $1
             AND deleted_at IS NULL
             AND id <> $2`,
          [req.organization.id, req.user.sub]
        );
        if (recipients.rows.length === 0) return;

        const appUrl = process.env.APP_URL || 'https://fieldmgr.com';
        const subjectLine = subject
          ? `[${orgDisplay}] ${subject}`
          : `[${orgDisplay}] New team note from ${senderName}`;
        const html = `
<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; padding:24px; max-width:600px; color:#2d2a26; line-height:1.55;">
  <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:#c98558;">Team note</div>
  ${subject ? `<h2 style="margin:6px 0 12px; font-size:20px;">${escapeHtml(subject)}</h2>` : '<div style="margin:6px 0 12px;"></div>'}
  <p style="margin:0 0 14px; font-size:13px; color:#6d6a64;">From <strong style="color:#2d2a26;">${escapeHtml(senderName)}</strong> · ${escapeHtml(orgDisplay)}</p>
  <div style="white-space:pre-wrap; font-size:14px; padding:14px 16px; background:#f7f4ec; border-radius:10px; border:1px solid #ece6d8;">${escapeHtml(message)}</div>
  <p style="margin:24px 0 0;"><a href="${appUrl}/dashboard" style="display:inline-block; background:#2c3e57; color:#fff; padding:11px 22px; border-radius:8px; text-decoration:none; font-weight:600;">Open Field Manager</a></p>
</body></html>`;
        const text = `Team note from ${senderName} (${orgDisplay})\n\n${subject ? subject + '\n\n' : ''}${message}\n\nOpen Field Manager: ${appUrl}/dashboard`;

        for (const r of recipients.rows) {
          // eslint-disable-next-line no-await-in-loop
          await sendEmail({
            to: r.email,
            subject: subjectLine,
            html,
            text,
          });
        }
      } catch (err) {
        console.error('team note: email fanout failed', err);
      }
    })();

    res.status(201).json(note);
  } catch (err) { next(err); }
});

// Mark a single message as read for the current user.
router.post('/:id/read', async (req, res, next) => {
  try {
    await query(
      `INSERT INTO team_message_reads (message_id, user_id)
       SELECT $1, $2
       FROM team_messages
       WHERE id = $1 AND organization_id = $3
       ON CONFLICT (message_id, user_id) DO NOTHING`,
      [req.params.id, req.user.sub, req.organization.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Delete a message. Allowed for the author or any admin in the org.
router.delete('/:id', async (req, res, next) => {
  try {
    let where = 'id = $1 AND organization_id = $2';
    const params = [req.params.id, req.organization.id];
    if (req.user.role !== 'admin') {
      where += ' AND author_user_id = $3';
      params.push(req.user.sub);
    }
    const { rowCount } = await query(`DELETE FROM team_messages WHERE ${where}`, params);
    if (rowCount === 0) return res.status(404).json({ error: 'Not found or not authorized' });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
