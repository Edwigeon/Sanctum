/**
 * Password policy shared by registration, password change and moderator bootstrap.
 * Lengths are measured in Unicode code points; a byte ceiling also caps scrypt input.
 */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;
export const PASSWORD_MAX_BYTES = 1024;
export const MODERATOR_PASSWORD_MIN = 16;

const COMMON = new Set([
  'password1234', 'password12345', 'password123456', '123456789012', '1234567890123',
  'qwertyuiopas', 'qwerty123456', 'letmein12345', 'iloveyou1234', 'administrator',
  'sanctum-mod', 'sanctummod123', 'changeme1234', 'welcome12345', 'adminadmin12'
]);

function codePoints(s) {
  return Array.from(s).length;
}

/** Returns null when acceptable, otherwise a user-safe error message. */
export function validatePassword(password, { username = '', strong = false } = {}) {
  if (typeof password !== 'string') return 'Password is required.';
  const len = codePoints(password);
  const min = strong ? MODERATOR_PASSWORD_MIN : PASSWORD_MIN;
  if (len < min) return `Password must be at least ${min} characters.`;
  if (len > PASSWORD_MAX || Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return `Password must be at most ${PASSWORD_MAX} characters.`;
  }
  if (/[\u0000-\u001f\u007f]/.test(password)) return 'Password contains invalid control characters.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'Password is too common.';
  if (new Set(password).size < (strong ? 8 : 4)) return 'Password is too repetitive.';
  if (username && lower.includes(String(username).toLowerCase())) return 'Password must not contain the username.';

  if (strong) {
    if (/replace|example|changeme|placeholder/i.test(password)) {
      return 'Password still looks like a placeholder value.';
    }
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(password)).length;
    // Long passphrases are accepted with fewer character classes.
    if (len < 24 && classes < 3) {
      return 'Moderator password needs 3 of: lowercase, uppercase, digit, symbol (or 24+ characters).';
    }
  }
  return null;
}
