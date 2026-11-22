import {menuUrl} from './menu-evidence.js';

// Search and site-map results are leads, never evidence of inventory or venue ownership.
const routeTerms = /(?:^|[^a-z])(book(?:ing)?|reserv(?:e|ation|ations)?|table|availability|dining)(?:[^a-z]|$)/i;
const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = value => normalize(value).split(' ').filter(part => part.length >= 3);
function safeUrl(raw) {
  try {
    const url = menuUrl(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}
export function rankBookingCandidates(results, venue, {limit = 10} = {}) {
  const nameWords = words(venue?.name), locationWords = words(venue?.address).filter(word => !['ghana', 'street', 'road', 'region'].includes(word));
  const seen = new Set(), candidates = [];
  for (const [index, result] of (Array.isArray(results) ? results : []).slice(0, 25).entries()) {
    const url = safeUrl(result?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = String(result?.title || '').slice(0, 200);
    const description = String(result?.description || result?.snippet || '').slice(0, 600);
    if (!title.trim()) continue;
    const parsed = new URL(url);
    const text = normalize(title + ' ' + description + ' ' + parsed.pathname.replace(/[-_]/g,' '));
    const nameMatch = nameWords.length > 0 && nameWords.every(word => text.split(' ').includes(word));
    const areaMatch = locationWords.some(word => text.split(' ').includes(word));
    const bookingPath = routeTerms.test(parsed.pathname.replace(/[-_]/g, ' '));
    const bookingText = routeTerms.test(title + ' ' + description);
    const score = (nameMatch ? 5 : 0) + (areaMatch ? 2 : 0) + (bookingPath ? 4 : 0) + (bookingText ? 2 : 0);
    candidates.push({title, url, description, score, evidence: {
      nameInSearchResult: nameMatch,
      areaInSearchResult: areaMatch,
      bookingWords: bookingPath || bookingText,
      ownership: 'unverified',
      availability: 'unknown'
    }, originalIndex:index});
  }
  candidates.sort((a,b) => b.score - a.score || a.originalIndex - b.originalIndex);
  return candidates.slice(0, Math.min(Math.max(limit, 0), 10)).map(({originalIndex,...candidate})=>candidate);
}

// A successful form inspection is reusable only as a route lead. It must be re-inspected
// and never becomes a trusted website, bookable slot, provider confirmation or approval.
export function createBookingRouteResolver({now = Date.now, ttlMs = 24 * 60 * 60 * 1000, maxEntries = 200} = {}) {
  const inspected = new Map();
  const key = (entityId, venue) => JSON.stringify([String(entityId).toUpperCase(), normalize(venue?.name), normalize(venue?.address)]);
  function expire() {
    for (const [k,v] of inspected) if (v.expires <= now()) inspected.delete(k);
    while (inspected.size > maxEntries) inspected.delete(inspected.keys().next().value);
  }
  return {
    rank:rankBookingCandidates,
    remember(entityId,venue,rawUrl) {
      // Expiring, queryless HTTPS routes only. Avoid persisting session tokens.
      const url = safeUrl(rawUrl);
      if (!url || new URL(url).search || !venue?.name || !venue?.address) return false;
      expire();
      const k = key(entityId,venue);
      inspected.delete(k);
      inspected.set(k,{url,observedAt:new Date(now()).toISOString(),expires:now()+ttlMs});
      expire();
      return true;
    },
    reuse(entityId,venue) {
      expire();
      const hit = inspected.get(key(entityId,venue));
      return hit ? [{title:'Previously inspected booking page',url:hit.url,description:'Form was previously inspected; venue identity, form and availability must be checked again.',source:'previous_inspection',observedAt:hit.observedAt}] : [];
    }
  };
}

