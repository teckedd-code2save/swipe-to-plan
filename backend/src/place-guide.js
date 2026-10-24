import { InputError } from './contract.js';
import { shapePlace } from './plan.js';
import { locationId } from './locations.js';

const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const text = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const clock = value => {
  const match = typeof value === 'string' && /^T?([01]\d|2[0-4]):([0-5]\d)(?::[0-5]\d)?$/.exec(value);
  if (!match || match[1] === '24' && match[2] !== '00') return null;
  return Number(match[1]) * 60 + Number(match[2]);
};
const time = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export function weeklyHours(raw) {
  return Object.fromEntries(DAYS.map(day => {
    const rows = raw?.[day];
    if (!Array.isArray(rows) || !rows.length || rows.length > 8) return [day, null];
    const intervals = [];
    for (const row of rows) {
      if (row?.closed === true) continue;
      const opens = clock(row?.opens), closes = clock(row?.closes);
      if (row?.closed !== false || opens === null || opens >= 1440 || closes === null || opens === closes) return [day, null];
      intervals.push({opens: time(opens), closes: time(closes), overnight: closes < opens});
    }
    return [day, intervals];
  }));
}
export function checkHours(hours, date, start, end, isClosed = false) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const intervals = hours?.[DAYS[day]], previous = hours?.[DAYS[(day + 6) % 7]];
  const base = {day: DAYS[day], intervals: intervals ?? null, sourceField:'properties.hours', date, start, end};
  if (isClosed) return {...base, status:'reported_closed', summary:'This place is reported closed. Choose another stop or confirm directly.'};
  const ranges = [...(intervals || []).map(row => [clock(row.opens), clock(row.closes) + (row.overnight ? 1440 : 0)]), ...(previous || []).filter(row => row.overnight).map(row => [clock(row.opens) - 1440, clock(row.closes)])].sort((a,b) => a[0]-b[0]);
  const merged = [];
  for (const range of ranges) { const last = merged.at(-1); if(last && range[0] <= last[1]) last[1] = Math.max(last[1],range[1]); else merged.push([...range]); }
  const fits = merged.some(([from,to]) => clock(start) >= from && clock(end) <= to);
  if (fits) return {...base,status:'fits_reported_hours',summary:`Your ${start}–${end} stop fits reported weekly hours.`};
  if (!intervals || clock(start) < 720 && !previous) return {...base,status:'unknown',summary:'There aren’t enough reported hours to check this stop.'};
  return {...base,status:'outside_reported_hours',summary:`Your ${start}–${end} stop falls outside reported weekly hours.`};
}
export function parsePlaceCheck(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['date','stops'].includes(k))) throw new InputError('Provide a date and up to three stops.');
  if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !Number.isFinite(Date.parse(`${body.date}T12:00:00Z`)) || new Date(`${body.date}T12:00:00Z`).toISOString().slice(0,10) !== body.date) throw new InputError('Choose a valid date.');
  if (!Array.isArray(body.stops) || !body.stops.length || body.stops.length > 3) throw new InputError('Choose one to three places to check.');
  const stops = body.stops.map(stop => {
    if (!stop || typeof stop !== 'object' || Object.keys(stop).some(k => !['entityId','start','end'].includes(k)) || typeof stop.start !== 'string' || typeof stop.end !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(stop.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(stop.end) || clock(stop.end) <= clock(stop.start)) throw new InputError('Provide a same-day time window for each stop.');
    return {entityId:locationId(stop.entityId),start:stop.start,end:stop.end};
  });
  return {date:body.date,stops};
}
export function createPlaceGuide({provider, now = Date.now}) {
  const cache = new Map();
  async function details(entityId) {
    const id = locationId(entityId), hit = cache.get(id);
    if (hit && now() - hit.at < 300000) return hit.value;
    if (!provider.getPlace) throw new InputError('Place details are not available from this provider.');
    const value = (async () => {
      const raw = await provider.getPlace(id), p = raw.properties || {};
      const normalized = {...raw, tags:(Array.isArray(raw.tags) ? raw.tags : []).map(t=>({...t,id:t.id||t.tag_id||t.value}))};
      const place = shapePlace(normalized,provider.name,new Date(now()).toISOString());
      const tags = normalized.tags.filter(t=>typeof t.id==='string');
      return {...place, description:text(p.description || p.short_description,1600), hours:weeklyHours(p.hours), isClosed:p.is_closed === true,
        highlights:[...new Set([...(Array.isArray(p.specialty_dishes) ? p.specialty_dishes : []).map(d=>text(d.name,80)), ...tags.filter(t=>/:menu_highlight:/.test(t.id)).map(t=>text(t.name,80))])].filter(Boolean).slice(0,8),
        practicalTags:tags.filter(t=>/^urn:tag:(accessibility|amenity|dietary_option|service_options):/.test(t.id)).map(t=>text(t.name,80)).filter(Boolean).slice(0,12),
        sourceNote:'Qloo provider data; its last update time is unknown. Weekly hours may differ on holidays or for private events.'};
    })();
    if(cache.size >= 256) cache.delete(cache.keys().next().value);
    cache.set(id,{at:now(),value});
    try{return await value;}catch(error){cache.delete(id);throw error;}
  }
  return {details, async check(input) {
    const request = parsePlaceCheck(input);
    const stops = await Promise.all(request.stops.map(async stop => {
      try { const place = await details(stop.entityId); return {...stop,place,hours:checkHours(place.hours,request.date,stop.start,stop.end,place.isClosed)}; }
      catch { return {...stop,error:'I couldn’t retrieve this place’s details. Try again or use the venue link.'}; }
    }));
    return {date:request.date,checkedAt:new Date(now()).toISOString(),stops,source:'qloo'};
  }};
}
