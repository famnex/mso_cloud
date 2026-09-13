// Auto supports direct HTTP installations and secures cookies on recognized HTTPS.
// Public HTTPS deployments should explicitly use COOKIE_SECURE=true.
function getSessionTransport(env) {
  const raw = (env.TRUST_PROXY || 'loopback').trim();
  const trustProxy = raw === 'true' ? true : raw === 'false' ? false
    : /^\d+$/.test(raw) ? Number(raw) : raw.split(',').map(value => value.trim());
  const cookie = (env.COOKIE_SECURE || 'auto').trim().toLowerCase();
  if (!['true', 'false', 'auto'].includes(cookie)) {
    throw new Error('COOKIE_SECURE must be true, false or auto');
  }
  return { trustProxy, secureCookie: cookie === 'auto' ? 'auto' : cookie === 'true' };
}
module.exports = { getSessionTransport };
