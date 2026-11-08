// Selectively adapted from Outing Actions route evidence (MIT), source revision 16b1c63.
// Copyright (c) 2026 Outing Actions contributors; see backend/licenses/outing-actions-MIT.txt.
import { RouteActionError, parseRouteRequest, navigationUrl } from './route-contract.js';
const MODES = ['DRIVE', 'WALK', 'TRANSIT'];
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FIELD_MASK = 'routes.duration,routes.distanceMeters,routes.legs.duration,routes.legs.distanceMeters,fallbackInfo';
function waypoint(point) {
  return point.coordinates ? { location: { latLng: { latitude: point.coordinates.lat, longitude: point.coordinates.lng } } } : { address: point.address };
}

export function buildGoogleRouteRequest(brief) {
  const body = {
    origin: waypoint(brief.origin), destination: waypoint(brief.stops[0]),
    travelMode: brief.mode, computeAlternativeRoutes: false, units: 'METRIC',
  };
  if (brief.mode === 'DRIVE') body.routingPreference = 'TRAFFIC_AWARE';
  if (brief.departureAt && brief.mode !== 'WALK') body.departureTime = brief.departureAt;
  return body;
}

function seconds(value) {
  const match = typeof value === 'string' && /^(\d+(?:\.\d{1,9})?)s$/.exec(value);
  const number = match ? Number(match[1]) : NaN;
  return Number.isFinite(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER ? number : null;
}

function checkFallback(payload, mode) {
  // This is response-level metadata, not a Route field. Request it explicitly so a
  // Google fallback cannot silently turn a driving estimate into traffic-unaware evidence.
  // https://developers.google.com/maps/documentation/routes/reference/rest/v2/FallbackInfo
  if (!Object.hasOwn(payload, 'fallbackInfo')) return;
  const fallback = payload.fallbackInfo;
  if (!fallback || typeof fallback !== 'object' || Array.isArray(fallback) ||
      !['FALLBACK_TRAFFIC_AWARE', 'FALLBACK_TRAFFIC_UNAWARE'].includes(fallback.routingMode) ||
      fallback.reason !== undefined && !['FALLBACK_REASON_UNSPECIFIED', 'SERVER_ERROR', 'LATENCY_EXCEEDED'].includes(fallback.reason)) {
    throw new RouteActionError('routes_bad_response');
  }
  if (mode === 'DRIVE' && fallback.routingMode === 'FALLBACK_TRAFFIC_UNAWARE') {
    throw new RouteActionError('routes_traffic_unavailable');
  }
}

// No environment reads here: only the live entrypoint provides the optional key.
// Each estimate is independent, ephemeral evidence; no planner or account stores are used.
export function createGoogleRouteAdapter({ apiKey, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 12000 } = {}) {
  const configured = typeof apiKey === 'string' && !!apiKey.trim();
  return {
    capabilities: () => ({ routeEstimates: configured, routeProvider: 'google_routes', modes: [...MODES], bookingSubmission: false, confirmedBookings: false }),
    async estimate(raw) {
      const brief = parseRouteRequest(raw, { now });
      if (!configured) throw new RouteActionError('provider_not_configured');
      const controller = new AbortController();
      let timer;
      // A deadline bounds both response headers and JSON body reads, even for injected transports.
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new RouteActionError('routes_timeout'));
        }, timeoutMs);
      });
      let payload;
      try {
        payload = await Promise.race([timeout, (async () => {
          let response;
          try {
            response = await fetchImpl(ROUTES_URL, {
              method: 'POST', redirect: 'error', signal: controller.signal,
              headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK },
              body: JSON.stringify(buildGoogleRouteRequest(brief)),
            });
          } catch {
            throw new RouteActionError(controller.signal.aborted ? 'routes_timeout' : 'routes_unreachable');
          }
          if (response?.status === 429) throw new RouteActionError('routes_rate_limited');
          if (!response?.ok) throw new RouteActionError('routes_provider_error');
          try { return await response.json(); }
          catch { throw new RouteActionError(controller.signal.aborted ? 'routes_timeout' : 'routes_bad_response'); }
        })()]);
      } finally { clearTimeout(timer); }

      // An empty routes array (or omitted routes, as protobuf JSON may encode it) means no route.
      if (payload && typeof payload === 'object' && !Array.isArray(payload) &&
          (Object.keys(payload).length === 0 || Array.isArray(payload.routes) && payload.routes.length === 0)) {
        throw new RouteActionError('route_not_found');
      }
      const route = Array.isArray(payload?.routes) && payload.routes[0];
      const validDistance = value => Number.isSafeInteger(value) && value >= 0;
      if (!route || !validDistance(route.distanceMeters) || seconds(route.duration) === null ||
          !Array.isArray(route.legs) || route.legs.length !== 1 ||
          !route.legs[0] || !validDistance(route.legs[0].distanceMeters) || seconds(route.legs[0].duration) === null) {
        throw new RouteActionError('routes_bad_response');
      }
      checkFallback(payload, brief.mode);
      const measuredAt = new Date(now()).toISOString();
      return {
        source: 'google_routes', measuredAt, mode: brief.mode,
        ...(brief.requestId !== undefined ? { requestId: brief.requestId } : {}),
        ...(brief.itineraryRevision !== undefined ? { itineraryRevision: brief.itineraryRevision } : {}),
        ...(brief.departureAt ? { departureAt: brief.departureAt } : {}),
        selectedStops: brief.stops,
        distanceMeters: route.distanceMeters, durationSeconds: seconds(route.duration),
        legs: [{ from: brief.origin, to: brief.stops[0], source: 'google_routes', measuredAt, mode: brief.mode,
          departureAt: brief.mode !== 'WALK' ? brief.departureAt || null : null,
          distanceMeters: route.legs[0].distanceMeters, durationSeconds: seconds(route.legs[0].duration) }],
        scheduleFeasibility: 'not_evaluated', includesVisitDurations: false, includesPlanningBuffers: false,
        trafficAware: brief.mode === 'DRIVE', navigationUrl: navigationUrl(brief),
        warning: 'Travel estimate only, not outing feasibility or guaranteed arrival. Visit durations and planning buffers are excluded. Recalculate after changing departure time or selected stops.',
      };
    },
  };
}
