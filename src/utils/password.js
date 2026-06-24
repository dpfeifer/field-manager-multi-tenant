const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return 'Password is required';
  }
  if (password.length < MIN_LENGTH) {
    return `Password must be at least ${MIN_LENGTH} characters`;
  }
  if (password.length > MAX_LENGTH) {
    return `Password must be at most ${MAX_LENGTH} characters`;
  }
  // Length-only requirement (NIST 800-63B): forced composition rules
  // (upper/lower/number/special) add signup friction without improving
  // security, so we require length and let users pick any characters.
  return null;
}

module.exports = { validatePassword };
