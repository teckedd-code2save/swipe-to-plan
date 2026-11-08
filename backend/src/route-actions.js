// Selectively adapted from Outing Actions route evidence (MIT), source revision 16b1c63.
// Copyright (c) 2026 Outing Actions contributors; see backend/licenses/outing-actions-MIT.txt.
import { InputError } from './contract.js';

const MODES = ['DRIVE', 'WALK', 'TRANSIT'];
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FIELD_MASK = 'routes.duration,routes.distanceMeters,routes.legs.duration,routes.legs.distanceMeters,fallbackInfo';
const ERRORS = {
  provider_not_configured: [503, 'Travel estimates are not connected on this server. Directions are still available.'],
  routes_unreachable: [502, 'Google Routes could not be reached. No travel estimate was produced.'],
  routes_timeout: [504, 'Google Routes took too long to respond. No travel estimate was produced.'],
  routes_rate_limited: [429, 'Travel estimates have reached their request limit. Please try again later.'],
  routes_provider_error: [502, 'Google Routes could not complete this request. No travel estimate was produced.'],
  routes_traffic_unavailable: [502, 'Google Routes could not provide a traffic-aware driving estimate. Directions are still available.'],
  routes_bad_response: [502, 'Google Routes returned incomplete or invalid measurements. No travel estimate was produced.'],
  route_not_found: [422, 'No route is available for these places and travel mode.'],
};

export class RouteActionError extends Error {
  constructor(code) {
    const [status, message] = ERRORS[code] || ERRORS.routes_provider_error;
    super(message);
    this.code = Object.hasOwn(ERRORS, code) ? code : 'routes_provider_error';
    this.status = status;
  }
}

function object(value, label, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) {
    throw new InputError(`${label} must be an object with only these fields: ${fields.join(', ')}.`);
  }
}

function string(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f<>]/.test(value)) {
    throw new InputError(`${label} must be a nonempty string of at most ${max} characters without control characters or angle brackets.`);
  }
  return value.trim();
}

function location(value, label) {
  object(value, label, ['id', 'entityId', 'name', 'coordinates', 'address']);
  const result = {};
  for (const [key, max] of [['id', 160], ['entityId', 200], ['name', 200], ['address', 300]]) {
    if (value[key] !== undefined) result[key] = string(value[key], `${label}.${key}`, max);
  }
  if (value.coordinates !== undefined) {
    object(value.coordinates, `${label}.coordinates`, ['lat', 'lng']);
    const { lat, lng } = value.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new InputError(`${label}.coordinates needs valid numeric lat and lng values.`);
    }
    result.coordinates = { lat, lng };
  }
  if (!result.coordinates && !result.address) throw new InputError(`${label} needs coordinates {lat,lng} or an address.`);
  return result;
}

function departureTime(value, now) {
  // Check the calendar separately: Date.parse silently rolls February 30 into March.
  const parts = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  const date = parts && Date.parse(`${parts[1]}T00:00:00Z`);
  const milliseconds = parts ? Date.parse(value) : NaN;
  if (!parts || !Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== parts[1] || !Number.isFinite(milliseconds)) {
    throw new InputError('departureAt must be a real, offset-aware ISO timestamp.');
  }
  if (milliseconds < now) throw new InputError('departureAt must not be in the past. Omit it to leave now.');
  return new Date(milliseconds).toISOString();
}

export function parseRouteRequest(value, { now = Date.now } = {}) {
  object(value, 'request', ['origin', 'stops', 'mode', 'departureAt', 'requestId', 'itineraryRevision']);
  if (!Array.isArray(value.stops) || value.stops.length !== 1) throw new InputError('stops must contain exactly one selected destination. Request each journey separately.');
  const mode = value.mode === undefined ? 'DRIVE' : value.mode;
  if (!MODES.includes(mode)) throw new InputError(`mode must be one of ${MODES.join(', ')}.`);
  const brief = { origin: location(value.origin, 'origin'), stops: [location(value.stops[0], 'stops[0]')], mode };
  if (value.departureAt !== undefined) brief.departureAt = departureTime(value.departureAt, now());
  if (value.requestId !== undefined) brief.requestId = string(value.requestId, 'requestId', 160);
  if (value.itineraryRevision !== undefined) {
    if (!Number.isSafeInteger(value.itineraryRevision) || value.itineraryRevision < 0) throw new InputError('itineraryRevision must be a nonnegative safe integer.');
    brief.itineraryRevision = value.itineraryRevision;
  }
  return brief;
}

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

function navigationUrl(brief) {
  const point = value => value.coordinates ? `${value.coordinates.lat},${value.coordinates.lng}` : value.address;
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('origin', point(brief.origin));
  url.searchParams.set('destination', point(brief.stops[0]));
  url.searchParams.set('travelmode', { DRIVE: 'driving', WALK: 'walking', TRANSIT: 'transit' }[brief.mode]);
  return url.toString();
}

// No environment reads here: only the live entrypoint provides the optional key.
// Each estimate is independent, ephemeral evidence; no planner or account stores are used.
export function createRouteActions({ apiKey, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 12000 } = {}) {
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
