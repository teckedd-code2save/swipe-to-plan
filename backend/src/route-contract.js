// Selectively adapted from Outing Actions route evidence (MIT), source revision 16b1c63.
// Copyright (c) 2026 Outing Actions contributors; see backend/licenses/outing-actions-MIT.txt.
import { InputError } from './contract.js';

const MODES = ['DRIVE', 'WALK', 'TRANSIT'];
const ERRORS = {
  provider_not_configured: [503, 'Travel estimates are not connected on this server. Directions are still available.'],
  routes_unreachable: [502, 'The route provider could not be reached. No travel estimate was produced.'],
  routes_timeout: [504, 'The route provider took too long to respond. No travel estimate was produced.'],
  routes_rate_limited: [429, 'Travel estimates have reached their request limit. Please try again later.'],
  routes_provider_error: [502, 'The route provider could not complete this request. No travel estimate was produced.'],
  routes_traffic_unavailable: [502, 'The route provider could not provide a traffic-aware driving estimate. Directions are still available.'],
  routes_bad_response: [502, 'The route provider returned incomplete or invalid measurements. No travel estimate was produced.'],
  routes_budget_exceeded: [429, 'This app has reached its daily route-request limit. Use Maps or try after the next UTC day.'],
  routes_budget_unavailable: [503, 'Route request accounting is unavailable. No provider request was started. Use Maps.'],
  routes_unsupported_mode: [422, 'This provider does not support this travel mode. Use Maps instead.'],
  routes_coordinates_required: [422, 'This provider needs coordinates for both places. Choose an area with a map pin or use Maps.'],
  routes_departure_unsupported: [422, 'Only leaving-now estimates are supported by this adapter. Use Maps for a scheduled trip.'],
  provider_display_incompatible: [503, 'This provider cannot be used with this map. Directions are still available.'],
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

export function navigationUrl(brief) {
  const point = value => value.coordinates ? `${value.coordinates.lat},${value.coordinates.lng}` : value.address;
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('origin', point(brief.origin));
  url.searchParams.set('destination', point(brief.stops[0]));
  url.searchParams.set('travelmode', { DRIVE: 'driving', WALK: 'walking', TRANSIT: 'transit' }[brief.mode]);
  return url.toString();
}
