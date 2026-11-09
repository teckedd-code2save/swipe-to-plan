// Public endpoints remain guest-only. Only planning calls may use the separate
// native account session; never borrow cookies, forge Origin or use shared-day keys.
export const PRODUCTION_API_ORIGIN = "https://unstressed.serendepify.com";

export function apiOrigin(value, development = false) {
  const url = new URL(value || PRODUCTION_API_ORIGIN);
  const local =
    /^(localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/.test(
      url.hostname,
    );
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(development && local && url.protocol === "http:"))
  ) {
    throw new Error(
      "Use an HTTPS API origin. Local HTTP is allowed only in development.",
    );
  }
  return url.origin;
}

// Compare the complete normalized origin, never a hostname suffix or display name.
// This is a destination label, not evidence that a server is available or isolated.
export function apiServerInfo(value, development = false) {
  const origin = apiOrigin(value, development);
  return { origin, isProduction: origin === PRODUCTION_API_ORIGIN };
}

export async function readPlanStream(response, onDiscovery) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Object.assign(
      new Error(body.error || `The request failed (${response.status}).`),
      { status: response.status, code: body.code },
    );
  }
  if (!response.headers.get("content-type")?.includes("application/x-ndjson"))
    return response.json();
  if (!response.body?.getReader)
    throw new Error("Streaming is unavailable. Please update this app.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    result,
    bytes = 0;
  function consume(line) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "discovery") onDiscovery?.(event.plan);
    else if (event.type === "complete") result = event.plan;
    else if (event.type === "error")
      throw new Error(
        event.error || "The review did not finish. Your previous plan is kept.",
      );
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      bytes += value?.byteLength || 0;
      if (bytes > 8 * 1024 * 1024)
        throw new Error(
          "This result is too large to load. Try a smaller outing.",
        );
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (!result)
      throw new Error(
        "The connection was interrupted. Your previous plan is kept.",
      );
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** @param {{origin: string, fetch: Function, timeout?: number, getAuthorization?: () => string | null, getPlanHeaders?: () => Record<string,string | undefined>, onUnauthorized?: (authorization: string) => void}} options */
export function createApi({ origin, fetch, timeout = 55000, getAuthorization = () => null, getPlanHeaders = () => ({}), onUnauthorized = () => {} }) {
  async function request(path, { body, signal, stream, onDiscovery } = {}) {
    const authenticated = path === "itineraries" || path === "agent";
    const authorization = authenticated ? getAuthorization() : null;
    const planHeaders = authorization ? getPlanHeaders() : {};
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(`${origin}/api/${path}`, {
        method: body === undefined ? "GET" : "POST",
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(stream ? { accept: "application/x-ndjson" } : {}),
          ...(authorization ? { authorization } : {}),
          ...(planHeaders["x-unstressed-plan-id"] ? {
            "x-unstressed-plan-id": planHeaders["x-unstressed-plan-id"],
            "x-unstressed-plan-revision": planHeaders["x-unstressed-plan-revision"],
          } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status === 401 && authorization) onUnauthorized(authorization);
      if (stream) return await readPlanStream(response, onDiscovery);
      const result = await response.json();
      if (!response.ok)
        throw Object.assign(
          new Error(result.error || `The request failed (${response.status}).`),
          { status: response.status, code: result.code },
        );
      return result;
    } catch (error) {
      if (controller.signal.aborted && !signal?.aborted)
        throw new Error(
          "This is taking too long. Your draft is kept. Try again when connected.",
        );
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  return {
    health: (signal) => request("health", { signal }),
    deck: (signal) => request("deck", { signal }),
    locations: (query, signal) =>
      request(`locations?q=${encodeURIComponent(query.trim())}`, { signal }),
    nearby: (point, signal) =>
      request("locations/nearby", { body: point, signal }),
    itinerary: (body, { signal, onDiscovery } = {}) =>
      request("itineraries", { body, signal, onDiscovery, stream: true }),
    agent: (body, signal) => request("agent", { body, signal }),
  };
}
