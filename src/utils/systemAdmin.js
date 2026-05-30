function isSystemAdminEmail(email) {
  if (!email) return false;
  const list = (process.env.SYSTEM_ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

module.exports = { isSystemAdminEmail };
