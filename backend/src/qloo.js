// Only the live entrypoint loads dotenv. Tests inject fetch/key and never read credentials.
export class ProviderError extends Error {
  constructor(code = "provider_unavailable") {
    super(({ provider_not_configured: "Qloo is not configured on this server.", provider_auth_error: "Qloo could not authorize this request. Check the existing server configuration.", provider_rate_limited: "Qloo has reached its request limit. Please wait before trying again." })[code] || "Discovery is temporarily unavailable. Please retry.");
    this.code = code; this.status = 503;
  }
}
const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
function entities(data) {
  const items = Array.isArray(data) ? data : data?.results?.entities ?? data?.results ?? data?.entities;
  if (!Array.isArray(items)) throw new ProviderError("provider_response_invalid");
  return items.filter((e) => e && typeof e === "object");
}
export function createQlooClient({ fetchImpl = globalThis.fetch, getKey = () => process.env.QLOO_API_KEY, baseUrl = process.env.QLOO_API_URL || "https://hackathon.api.qloo.com", now = Date.now } = {}) {
  const cache = new Map();
  async function call(path, params) {
    const key = getKey();
    if (!key) throw new ProviderError("provider_not_configured");
    const url = new URL(path, baseUrl);
    for (const [k, v] of Object.entries(params)) if (v !== "") url.searchParams.set(k, String(v));
    try {
      const res = await fetchImpl(url, { headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(8000) });
      if ([401, 403].includes(res.status)) throw new ProviderError("provider_auth_error");
      if (res.status === 429) throw new ProviderError("provider_rate_limited");
      if (!res.ok) throw new ProviderError();
      return entities(await res.json());
    } catch (e) { if (e instanceof ProviderError) throw e; throw new ProviderError(); }
  }
  return {
    name: "qloo",
    async resolveArtist(name) {
      const key = norm(name);
      const hit = cache.get(key);
      if (hit && now() - hit.at < 86400000) return hit.value;
      const matches = (await call("/search", { query: name, take: 5 })).filter((e) => {
        const types = Array.isArray(e.types) ? e.types : [e.type];
        return norm(e.name) === key && types.includes("urn:entity:artist") && typeof (e.entity_id ?? e.id) === "string";
      });
      const unique = [...new Map(matches.map((e) => [e.entity_id ?? e.id, e])).values()];
      if (unique.length !== 1) return { status: "unresolved", reason: unique.length ? "ambiguous" : "no_exact_artist_match" };
      const value = { status: "resolved", entityId: unique[0].entity_id ?? unique[0].id, name: unique[0].name };
      if (cache.size >= 256) cache.delete(cache.keys().next().value);
      cache.set(key, { at: now(), value });
      return value;
    },
    async discover({ signalIds, area }) {
      return call("/v2/insights", {
        "filter.type": "urn:entity:place", "signal.interests.entities": signalIds.join(","),
        "filter.location.query": area === "Accra" ? "Accra, Ghana" : `${area}, Accra, Ghana`, take: 50,
      });
    },
  };
}
