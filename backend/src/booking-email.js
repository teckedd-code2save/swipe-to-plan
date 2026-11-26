const base = 'https://api.cloudflare.com/client/v4/accounts';
const addressPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const bookingEmailAddress = value => typeof value === 'string' && value.length <= 90 && addressPattern.test(value) ? value.toLowerCase() : null;

export const verificationCooldown = 15 * 60_000;

export function createBookingEmail({
  enabled = process.env.BOOKING_EMAIL_ENABLED === 'true',
  accountId = process.env.BOOKING_EMAIL_CF_ACCOUNT_ID,
  routingToken = process.env.BOOKING_EMAIL_CF_ROUTING_TOKEN,
  sendingToken = process.env.BOOKING_EMAIL_CF_SENDING_TOKEN,
  from = process.env.BOOKING_EMAIL_FROM,
  fetchImpl = fetch,
} = {}) {
  const available = !!(enabled && /^[a-f0-9]{32}$/i.test(accountId || '') && routingToken && sendingToken && bookingEmailAddress(from));
  const addresses = '/email/routing/addresses';
  async function request(path, {method = 'GET', body, token = routingToken} = {}) {
    const response = await fetchImpl(base + '/' + accountId + path, {
      method,
      headers: {Authorization: 'Bearer ' + token, ...(body ? {'Content-Type': 'application/json'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(3500),
    });
    if (response.status === 404 && method === 'GET' && path.startsWith(addresses + '/')) return null;
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success !== true || !payload.result)
      throw new Error('Cloudflare booking email request did not succeed.');
    return payload;
  }
  function match(record, email) {
    return bookingEmailAddress(record?.email) === email && /^[a-zA-Z0-9_-]{1,32}$/.test(record?.id || '') ? {
      id: record.id,
      verified: typeof record.verified === 'string' && Number.isFinite(Date.parse(record.verified)),
    } : null;
  }
  async function lookup(email) {
    // There is no destination-by-email filter. Bound reconciliation to the documented account limit.
    for (let page = 1; page <= 4; page++) {
      const payload = await request(addresses + '?per_page=50&page=' + page);
      if (!Array.isArray(payload.result)) throw new Error('Cloudflare destination list unavailable.');
      const found = payload.result.map(row => match(row, email)).find(Boolean);
      if (found) return found;
      if (payload.result.length < 50 || (payload.result_info?.total_pages && payload.result_info.total_pages <= page)) return null;
    }
    return null;
  }
  return {
    available,
    async register(email, {reconcile = false} = {}) {
      if (reconcile) {
        const existing = await lookup(email);
        if (existing) return existing;
      }
      // Recover from a lost acknowledgement by reconciling on a later user request,
      // never by blindly sending again or deleting an account-wide destination.
      const {result} = await request(addresses, {method: 'POST', body: {email}});
      const record = match(result, email);
      if (!record) throw new Error('Cloudflare returned no matching destination.');
      return record;
    },
    lookup,
    async status(email, id) {
      if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id || '')) return null;
      return match((await request(addresses + '/' + id))?.result, email);
    },
    async sendUpdate(email, outcome, origin) {
      const labels = {
        awaiting_reply: 'Awaiting a reply',
        confirmed: 'Marked confirmed by you',
        unavailable: 'Marked unavailable by you',
        cancelled: 'Marked cancelled by you',
      };
      if (!Object.hasOwn(labels, outcome)) return;
      await request('/email/sending/send', {token: sendingToken, method: 'POST', body: {
        from, to: [email], subject: 'Your Unstressed booking update',
        text: 'Booking status: ' + labels[outcome] + '.\n\nYou recorded this update in Unstressed. It is not an independent confirmation from the venue.\n\nOpen Unstressed to review: ' + origin,
      }});
    },
  };
}
