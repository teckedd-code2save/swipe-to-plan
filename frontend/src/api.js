async function json(url, options = {}) {
  const response = await fetch(url, { headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(25000), ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}
const post = (body) => ({ method: "POST", body: JSON.stringify(body) });
export const api = {
  health: () => json("/api/health"), deck: () => json("/api/deck"),
  recommend: (body) => json("/api/recommend", post(body)),
  createRoom: (body) => json("/api/rooms", post(body)),
  room: (code) => json(`/api/rooms/${encodeURIComponent(code)}`),
  join: (code, body) => json(`/api/rooms/${encodeURIComponent(code)}/members`, post(body)),
  plan: (code, body = {}) => json(`/api/rooms/${encodeURIComponent(code)}/plan`, post(body)),
};
