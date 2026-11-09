import { contactForItem, safeContactWebsite } from '../../shared/venue-contact.js';
import { coordinatePair } from '../../shared/route-provider.js';
import { apiOrigin } from './transport.js';

const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const record = value => object(value) ? value : {};
const rows = (value, max = 30) => Array.isArray(value) ? value.slice(0, max) : [];
export const detailText = (value, max = 2000) => typeof value === 'string' && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f<>]/.test(value) ? value.trim() : '';
const texts = (value, max = 12) => [...new Set(rows(value, max).map(value => detailText(value, 200)).filter(Boolean))];
const clock = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const closeClock = value => clock(value) || value === '24:00';
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10000000;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const sameEntity = (a, b) => uuid(a) && uuid(b) && a.toUpperCase() === b.toUpperCase();
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
function retrieved(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return '';
  const stamp = new Date(value);
  return Number.isFinite(stamp.getTime()) ? stamp.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '';
}
export function detailMoney(value, currency) {
  if (!amount(value) || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return null;
  try { return new Intl.NumberFormat('en', {style:'currency', currency, maximumFractionDigits:0}).format(value); }
  catch { return `${currency} ${Math.round(value).toLocaleString('en')}`; }
}
function periods(value) {
  if (!Array.isArray(value) || value.length > 8 || !value.every(row => object(row) && clock(row.opens) && closeClock(row.closes) && typeof row.overnight === 'boolean' && row.opens !== row.closes && row.overnight === (row.closes < row.opens))) return null;
  return value.length ? value.map(row => `${row.opens}–${row.closes}${row.overnight ? ' (+1 day)' : ''}`).join(' · ') : 'Reported closed';
}

// Only known text and finite values leave this selector for native JSX.
// Contact destinations always go through the shared identity-aware sanitizer.
export function venueDetailsData(raw) {
  const place = record(raw), facts = record(place.facts), provenance = record(place.provenance);
  let contact;
  try { contact = place.contact?.identityStatus === 'conflicting' ? {...contactForItem({}), identityStatus:'conflicting'} : contactForItem(place); }
  catch { contact = {...contactForItem({}), identityStatus:'conflicting'}; }
  const conflicting = contact.identityStatus === 'conflicting';
  const level = facts.price?.status === 'provider_reported' && Number.isInteger(facts.price?.level) ? facts.price.level : 0;
  const hours = days.flatMap(day => {
    const label = periods(record(place.hours)[day]);
    return label ? [{day:day[0].toUpperCase() + day.slice(1), label}] : [];
  });
  const provider = detailText(provenance.provider, 80);
  const at = retrieved(provenance.retrievedAt);
  return {
    name: detailText(place.name, 500) || 'Venue',
    description: detailText(place.description, 2000),
    address: detailText(place.address, 2000),
    tags: texts(place.tagNames), highlights: texts(place.highlights, 8), practicalTags: texts(place.practicalTags), hours,
    reportedClosed: place.isClosed === true,
    price: [null, 'Lower price band', 'Mid price band', 'Higher price band', 'Premium price band'][level] || 'Price band not supplied',
    childSuitability: facts.childSuitability?.status === 'provider_reported',
    imageUrl: safeContactWebsite(place.image),
    menuUrl: safeContactWebsite(record(place.links).menu),
    websiteUrl: conflicting ? null : safeContactWebsite(contact.website?.url),
    phone: conflicting ? '' : detailText(contact.phone?.display, 200),
    dialUrl: !conflicting && typeof contact.phone?.dialUrl === 'string' && /^tel:\+[1-9][0-9]{7,14}$/.test(contact.phone.dialUrl) ? contact.phone.dialUrl : null,
    phoneNeedsCountry: contact.phone?.format === 'local_only', conflicting,
    contactSource: detailText(contact.phone?.source?.provider || contact.website?.source?.provider, 80) || 'saved venue data',
    source: provider ? `${provider === 'qloo' ? 'Qloo' : provider}${at ? ` · retrieved ${at}` : ' · retrieval time unknown'}` : 'Saved venue data · retrieval time unknown',
    refreshable: provider === 'qloo' && uuid(place.entityId),
  };
}

function selectedVisit(stop, plan) {
  return rows(plan?.stops, 3).find(candidate => candidate?.id === stop?.id && candidate?.item?.id === stop?.item?.id && candidate?.item?.entityId === stop?.item?.entityId && candidate?.start === stop?.start && candidate?.end === stop?.end);
}
export function visitDetailsData(stop, plan) {
  const selected = selectedVisit(stop, plan), request = record(plan?.request);
  const allocations = rows(record(plan?.budget).allocations, 3);
  const allocation = selected ? allocations.find(row => object(row) && row.stopId === stop.id) || (rows(plan?.stops, 3).filter(row => row?.intent === stop.intent).length === 1 ? allocations.find(row => object(row) && !row.stopId && row.intent === stop.intent) : null) : null;
  const people = rows(request.people, 6);
  const connections = selected ? people.flatMap(person => {
    const name = detailText(person?.name, 24), id = detailText(person?.id, 64);
    if (!name || !id) return [];
    const evidence = rows(selected.connections, 420).filter(edge => edge?.personId === id && detailText(edge.label, 2000) && detailText(edge.kind, 64)).slice(0, 6).map(edge => ({label:edge.kind === 'search_signal' ? 'Used to discover this place; not a confirmed individual match.' : detailText(edge.label, 2000), kind:detailText(edge.kind, 64)}));
    return evidence.length ? [{id, name, evidence}] : [];
  }) : [];
  const fit = record(stop?.item?.experienceFit);
  const experience = ['cuisine', 'atmosphere'].flatMap(kind => {
    const value = record(fit[kind]), requested = detailText(value.requested, 160);
    if (!requested || !['provider_text_signal', 'unverified'].includes(value.status)) return [];
    return [{label:`${requested} ${kind}`, detail:value.status === 'provider_text_signal' ? 'Mentioned in provider text. Confirm the current menu or setting.' : 'Not verified in the available venue information.'}];
  });
  return {
    selected:!!selected,
    allowance:detailMoney(allocation?.amount, request.currency),
    time:clock(stop?.start) && clock(stop?.end) ? `${stop.start}–${stop.end}` : 'Time to choose',
    connections, experience,
    buffer:selected && Number.isInteger(selected.bufferAfterMinutes) && selected.bufferAfterMinutes > 0 && selected.bufferAfterMinutes <= 240 ? selected.bufferAfterMinutes : null,
  };
}

function mapPoint(item) {
  if (!item || detailText(item.id, 160).startsWith('demo:')) return null;
  const name = detailText(item.name, 500), address = detailText(item.address, 2000), coordinates = record(item.coordinates);
  if (!name) return null;
  return coordinatePair([coordinates.lng, coordinates.lat]) ? `${coordinates.lat},${coordinates.lng}` : [name, address].filter(Boolean).join(', ');
}
// Routes contain returned venues only, never the person's current location.
// This is a handoff to Maps, not a travel-time estimate.
export function dayMapsUrl(plan, mode = 'driving') {
  if (!['driving', 'walking', 'transit'].includes(mode)) return null;
  const stops = rows(plan?.stops, 3).filter(stop => stop?.item);
  const points = stops.map(stop => mapPoint(stop.item));
  if (!points.length || points.some(point => !point) || (mode === 'transit' && points.length > 2)) return null;
  if (points.length === 1) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(points[0])}`;
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1'); url.searchParams.set('origin', points[0]); url.searchParams.set('destination', points[points.length - 1]); url.searchParams.set('travelmode', mode);
  if (points.length > 2) url.searchParams.set('waypoints', points.slice(1, -1).join('|'));
  return url.href;
}
export const venueMapsUrl = stop => dayMapsUrl({stops:[stop]});
export function dayRouteLegs(plan, mode = 'driving') {
  const stops = rows(plan?.stops, 3).filter(stop => stop?.item);
  return stops.slice(1).map((stop, index) => ({
    id:`${index}-${detailText(stop.id, 160)}`,
    label:`${index + 1}. ${venueDetailsData(stops[index].item).name} to ${venueDetailsData(stop.item).name}`,
    url:dayMapsUrl({stops:[stops[index], stop]}, mode),
  })).filter(leg => leg.url);
}
export function readinessData(plan) {
  const request = record(plan?.request), budget = record(plan?.budget), allowance = record(plan?.allowance);
  const total = detailMoney(request.budget ?? allowance.amount, request.currency);
  return {
    total, suggested:request.budget == null,
    transport:detailMoney(budget.transport, request.currency), reserve:detailMoney(budget.reserve, request.currency),
    note:detailText(budget.note, 2000),
    timeZone:detailText(plan?.timeZone, 80),
    date:request.timing?.dateConfirmed === true && date(request.date) ? request.date : 'Date to choose',
    warnings:rows(plan?.warnings, 30).map(value => detailText(value, 4000)).filter(Boolean),
    timingNotes:rows(plan?.timingNotes, 10).map(value => detailText(value, 2000)).filter(Boolean),
  };
}
export function detailScopeKey(plan, stop) {
  return JSON.stringify([plan?.request?.date, plan?.phase, plan?.request?.timing?.dateConfirmed, plan?.request?.timing?.timeConfirmed, stop?.id, stop?.item?.id, stop?.item?.entityId, stop?.start, stop?.end, plan?.timeZone, plan?.provenance?.retrievedAt]);
}
function canCheckTiming(plan, stop) {
  return plan?.phase !== 'discovery' && plan?.phase !== 'needs_timing' && plan?.request?.timing?.dateConfirmed === true && plan?.request?.timing?.timeConfirmed === true && date(plan?.request?.date) && clock(stop?.start) && clock(stop?.end) && stop.end > stop.start;
}
export function normalizeVenueReport(result, plan, stop, timed) {
  let report = result;
  if (timed) {
    if (!object(result) || result.date !== plan.request.date || !Array.isArray(result.stops) || result.stops.length > 3) throw new Error('The venue check did not match this day. Please try again.');
    report = result.stops.find(row => object(row) && sameEntity(row.entityId, stop.item.entityId) && row.start === stop.start && row.end === stop.end);
    if (!report || report.error) throw new Error('Venue details could not be checked. Try again or contact the venue directly.');
  } else report = {place:result};
  const place = report?.place;
  if (!object(place) || !sameEntity(place.entityId, stop.item.entityId) || !detailText(place.name, 500) || place.provenance?.provider !== 'qloo' || !sameEntity(place.provenance?.entityId, stop.item.entityId)) throw new Error('The returned details do not match this venue. No contact links were added.');
  const statuses = {fits_reported_hours:'Fits reported weekly hours', outside_reported_hours:'Visit time needs a check', reported_closed:'Reported closed', unknown:'Hours still need confirming'};
  const status = timed && typeof report.hours?.status === 'string' && Object.hasOwn(statuses, report.hours.status) ? report.hours.status : 'unknown';
  const summary = timed ? detailText(report.hours?.summary, 2000) : 'Choose a date and visit time to check them against reported weekly hours.';
  return {place, hours:{status, label:statuses[status], summary:summary || 'No usable hours check was supplied.', intervals:timed ? periods(report.hours?.intervals) : null}, checkedAt:retrieved(result?.checkedAt)};
}

// Explicit read-only refreshes only. No cookies, account auth or auto-contact.
export function createDayDetailsApi({origin, fetch, timeout = 25000, development = false}) {
  const base = apiOrigin(origin, development);
  return {async load(plan, stop, signal) {
    if (!venueDetailsData(stop?.item).refreshable) throw new Error('Reported details are not available for this venue.');
    const timed = canCheckTiming(plan, stop), controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, {once:true});
    const timer = setTimeout(abort, timeout);
    try {
      const response = await fetch(`${base}/api/${timed ? 'place-checks' : `places/${encodeURIComponent(stop.item.entityId)}`}`, {
        method:timed ? 'POST' : 'GET', credentials:'omit', redirect:'error', signal:controller.signal,
        headers:{'content-type':'application/json'},
        ...(timed ? {body:JSON.stringify({date:plan.request.date, stops:[{entityId:stop.item.entityId, start:stop.start, end:stop.end}]})} : {}),
      });
      if (!response.ok) throw new Error('Venue details could not be checked. Try again when connected.');
      const result = await response.json();
      return normalizeVenueReport(result, plan, stop, timed);
    } catch (error) {
      if (controller.signal.aborted && !signal?.aborted) throw new Error('The venue check took too long. Please try again.');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }};
}

// Keep the native runtime independent of the browser bundle. Match the web
// enquiry rules: a real future instant in the destination zone, with no guessed
// daylight-saving offset or ambiguous repeated clock time.
export function reservationEligible(snapshot, now = Date.now()) {
  const {date:day, localTime, timeZone, party} = record(snapshot);
  if (!date(day) || !clock(localTime) || !detailText(timeZone, 80)) return false;
  if (!Number.isInteger(party?.adults) || party.adults < 1 || party.adults > 100 || !Number.isInteger(party.children) || party.children < 0 || party.children > 100) return false;
  const base = Date.parse(`${day}T${localTime}:00Z`);
  if (!Number.isFinite(base)) return false;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
    const matches = [];
    for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
      const instant = base + offset * 60000;
      const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
      if (`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` === `${day}T${localTime}`) matches.push(instant);
    }
    return matches.length === 1 && matches[0] > now;
  } catch { return false; }
}

// A locally prepared, selectable draft. No endpoint or share action sends it.
export function enquiryDraft(plan, stop, now = Date.now()) {
  const name = venueDetailsData(stop?.item).name;
  const party = record(plan?.request?.party);
  const adults = Number.isInteger(party.adults) && party.adults > 0 && party.adults <= 100 ? party.adults : null;
  const children = Number.isInteger(party.children) && party.children >= 0 && party.children <= 100 ? party.children : null;
  const group = adults !== null && children !== null ? ` for ${adults} adult${adults === 1 ? '' : 's'}${children ? ` and ${children} child${children === 1 ? '' : 'ren'}` : ''}` : '';
  const request = record(plan?.request);
  const snapshot = {date:request.timing?.dateConfirmed === true ? request.date : null, localTime:request.timing?.timeConfirmed === true ? stop?.start : null, timeZone:detailText(plan?.timeZone, 80), party:{adults, children}};
  const timed = !!selectedVisit(stop, plan) && reservationEligible(snapshot, now);
  const when = timed ? ` on ${snapshot.date} at ${snapshot.localTime} (${snapshot.timeZone})` : '';
  return `Hello ${name},\n\nWe’re considering a visit${when}${group}. Could you share your current opening hours, availability and reservation process? Please also share your current menu or prices, any deposits or entry fees, and how to discuss dietary or accessibility needs.\n\nThank you!`;
}
