import { apiOrigin } from './transport.js';

export function signInRetryDelay(retryAfter, attempt, now) {
  const fallback = Math.min(60000, 5000 * (2 ** Math.min(attempt, 4)));
  if (typeof retryAfter !== 'string' || !retryAfter.trim()) return fallback;
  const value = retryAfter.trim();
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : (/^[A-Za-z]{3}, /.test(value) ? Date.parse(value) - now : NaN);
  // Never retry sooner than a valid server directive. Huge directives expire the flow.
  return Number.isFinite(delay) && delay >= 0 ? Math.max(2000, Math.min(delay, 600000)) : fallback;
}
function waitForPoll(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error('Sign-in cancelled.')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

// Tokens and PKCE secrets exist only in this closure. Never persist or log this object.
export function createAccountSession({ origin, development = false, fetch, randomBytes, sha256, openBrowser, now = Date.now, timeout = 15000, wait = waitForPoll }) {
  const trustedOrigin = apiOrigin(origin, development);
  let token = null, expiresAt = 0, epoch = 0, pending = null, userId = null;
  let snapshot = { signedIn: false, signingIn: false, userId: null, sessionEpoch: 0, userCode: null, signInStatus: null };
  const listeners = new Set();
  const emit = () => { snapshot = { signedIn: !!token, signingIn: !!pending, userId, sessionEpoch: epoch, userCode: pending?.userCode || null, signInStatus: pending?.status || null }; listeners.forEach(fn => fn(snapshot)); };
  const reset = () => { epoch++; token = null; userId = null; expiresAt = 0; pending?.controller.abort(); pending = null; emit(); };
  const authorization = () => { if (token && expiresAt <= now()) reset(); return token ? { authorization: `Bearer ${token}` } : {}; };
  async function request(path, { method = 'GET', body, signal, authenticated = false, headers, deadline } = {}) {
    const auth = authenticated ? authorization() : {};
    if (authenticated && !auth.authorization) throw new Error('Sign in to access your account.');
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, deadline === undefined ? timeout : Math.max(0, Math.min(timeout, deadline - now()))), version = epoch;
    try {
      const response = await fetch(`${trustedOrigin}${path}`, { method, credentials: 'omit', redirect: 'error', signal: controller.signal,
        headers: { 'content-type': 'application/json', ...auth, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      let data;
      try { data = await response.json(); } catch { if (response.ok) throw new Error('The account server returned an invalid response.'); data = {}; }
      if (version !== epoch || controller.signal.aborted) throw new Error('This account request was cancelled.');
      if (!response.ok) {
        if (response.status === 401 && authenticated) reset();
        throw Object.assign(new Error(typeof data.error === 'string' ? data.error : 'Your account request could not be completed.'), { status: response.status, ...(response.status === 429 ? { retryAfter: response.headers?.get('retry-after') } : {}) });
      }
      return { data, status: response.status };
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  const account = async (path = '', options = {}) => {
    if (!/^\/(?:plans|circles|invitations|invitation-settings|profile|circle-plans)(?:\/[A-Za-z0-9_-]+)*$/.test(path) && path !== '') throw new Error('Unsupported account request.');
    return (await request(`/api/native/account${path}`, { ...options, authenticated: true })).data;
  };
  async function cancelSignIn() {
    const previous = pending; reset();
    if (previous?.flowId) await request('/api/auth/native/cancel', { method: 'POST', body: { flowId: previous.flowId, codeVerifier: previous.verifier } });
  }
  async function signIn() {
    if (pending || token) throw new Error('Sign-in is already active.');
    const controller = new AbortController(), version = ++epoch;
    pending = { controller }; emit();
    try {
      const bytes = await randomBytes(32);
      const verifier = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      const challenge = (await sha256(verifier)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (version !== epoch) throw new Error('Sign-in cancelled.');
      const { data } = await request('/api/auth/native/start', { method: 'POST', body: { codeChallenge: challenge, codeChallengeMethod: 'S256' }, signal: controller.signal });
      const url = new URL(data.browserUrl), deadline = typeof data.expiresAt === 'number' ? data.expiresAt : Date.parse(data.expiresAt);
      if (url.origin !== trustedOrigin || url.username || url.password || url.hash || url.pathname !== '/api/auth/native/browser' || url.searchParams.get('flow') !== data.flowId || [...url.searchParams.keys()].some(key => key !== 'flow') || !/^[A-Z0-9_-]{8}$/.test(data.userCode) || !Number.isFinite(deadline) || deadline <= now() || typeof data.flowId !== 'string') throw new Error('The sign-in response was not trusted.');
      pending = { controller, flowId: data.flowId, verifier, userCode: data.userCode }; emit();
      const boundedDeadline = Math.min(deadline, now() + 600000);
      await openBrowser(url.href);
      let rateLimitAttempts = 0;
      while (now() < boundedDeadline) {
        if (version !== epoch || controller.signal.aborted) throw new Error('Sign-in cancelled.');
        let result;
        try {
          result = await request('/api/auth/native/exchange', { method: 'POST', body: { flowId: data.flowId, codeVerifier: verifier }, signal: controller.signal, deadline: boundedDeadline });
        } catch (error) {
          // Only an explicit pre-execution rate-limit rejection is safe to retry.
          // Network failures, malformed success and every other status remain terminal.
          if (error.status !== 429 || version !== epoch || controller.signal.aborted) throw error;
          const remaining = boundedDeadline - now();
          if (remaining <= 0) break;
          const delay = Math.min(remaining, signInRetryDelay(error.retryAfter, rateLimitAttempts++, now()));
          pending.status = 'Sign-in checks are temporarily busy. Retrying automatically; you can still cancel.'; emit();
          await wait(delay, controller.signal);
          continue;
        }
        if (now() >= boundedDeadline) break;
        rateLimitAttempts = 0;
        if (pending.status) { pending.status = null; emit(); }
        if (result.status === 200) {
          const expiry = typeof result.data.expiresAt === 'number' ? result.data.expiresAt : Date.parse(result.data.expiresAt);
          if (typeof result.data.accessToken !== 'string' || !/^ust_native_[A-Za-z0-9_-]+$/.test(result.data.accessToken) || !Number.isFinite(expiry) || expiry <= now()) throw new Error('The app session response was invalid.');
          token = result.data.accessToken; expiresAt = expiry;
          try { const profile = await account('', { signal: controller.signal }); if (!profile.user?.id) throw new Error('Account identity unavailable.'); userId = profile.user.id; } catch (error) { reset(); throw error; }
          pending = null; emit(); return;
        }
        if (result.status !== 202 || result.data.status !== 'pending') throw new Error('The sign-in response was invalid.');
        await wait(Math.min(boundedDeadline - now(), Math.max(2, Math.min(10, Number(data.pollInterval) || 2)) * 1000), controller.signal);
      }
      throw new Error('Sign-in expired. Please start again.');
    } finally { if (version === epoch) { pending = null; emit(); } }
  }
  return {
    origin: trustedOrigin, account, signIn, cancelSignIn,
    config: async () => { try { return (await request('/api/auth/native/config')).data; } catch (error) { if (error.status === 404) return { enabled: false, available: false }; throw error; } },
    getAuthorization: () => { const expired = token && expiresAt <= now(); const header = authorization().authorization || null; if (expired) throw new Error('Your account session expired. Sign in again before continuing.'); return header; },
    invalidateAuthorization: captured => { if (captured && captured === authorization().authorization) reset(); },
    getSnapshot: () => { authorization(); return snapshot; },
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async logout() {
      const headers = authorization(); reset();
      if (!headers.authorization) return;
      try { await request('/api/native/auth/logout', { method: 'POST', body: {}, headers }); }
      catch { throw new Error('Signed out on this device. Server revocation could not be confirmed; the short-lived session will expire automatically.'); }
    },
  };
}

export function connectedPeople(account) {
  const people = new Map();
  for (const circle of account?.circles || []) for (const person of circle.people || []) {
    if (person.id !== account.user?.id && circle.accountIds?.includes(person.id)) people.set(person.id, person);
  }
  return [...people.values()];
}
