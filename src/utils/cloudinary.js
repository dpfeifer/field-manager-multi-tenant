const crypto = require('crypto');

// Build a short-lived Cloudinary signed-upload payload. The browser uploads
// the file straight to Cloudinary with this, so bytes never touch our server.
// Returns null when Cloudinary isn't configured. Shared by the system-admin
// landing uploader and the tenant settings (logo) uploader.
function cloudinarySignature() {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !key || !secret) return null;
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'fieldmgr/uploads';
  // Params sorted by key, joined "key=value&...", api secret appended, SHA-1.
  const toSign = `folder=${folder}&timestamp=${timestamp}`;
  const signature = crypto.createHash('sha1').update(toSign + secret).digest('hex');
  return { cloud_name: cloud, api_key: key, timestamp, folder, signature };
}

module.exports = { cloudinarySignature };
