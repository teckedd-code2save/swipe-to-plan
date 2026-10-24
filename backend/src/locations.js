import countryToCurrency from 'country-to-currency';
import ct from 'countries-and-timezones';
import {find as findTimeZones} from 'geo-tz';
import {InputError} from './contract.js';

// Neighborhood precision is enough to suggest an area. Never retain a device fix.
export function approximatePoint(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['latitude','longitude'].includes(key)))throw new InputError('Provide a location to find nearby areas.');
  const {latitude,longitude}=value;
  if(!Number.isFinite(latitude)||Math.abs(latitude)>90||!Number.isFinite(longitude)||Math.abs(longitude)>180)throw new InputError('Provide valid location coordinates.');
  return {latitude:Math.round(latitude*100)/100,longitude:Math.round(longitude*100)/100};
}

export function nearbyRequest(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new InputError('Provide a location to find nearby areas.');
  const {radiusKm=20,...point}=value;
  if(![20,50,100].includes(radiusKm))throw new InputError('Choose a search distance of 20, 50 or 100 km.');
  return {point:approximatePoint(point),radiusKm};
}

export function areaDistanceKm(point,location){
  const lat=location?.lat,lon=location?.lon??location?.lng;
  if(!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lon)||Math.abs(lon)>180)return null;
  const rad=v=>v*Math.PI/180;
  const a=Math.sin(rad(lat-point.latitude)/2)**2+Math.cos(rad(point.latitude))*Math.cos(rad(lat))*Math.sin(rad(lon-point.longitude)/2)**2;
  return Math.round(6371*2*Math.asin(Math.sqrt(Math.min(1,a))));
}

export function locationId(value){
  if(typeof value!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new InputError('Choose a location from the search results.');
  return value.toUpperCase();
}
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const countryNames=new Map([['unitedstatesofamerica','US'],['uk','GB'],['usa','US'],['uae','AE']]);
for(const locale of ['en','fr','de','es','pt','ja','zh','ko','ar','ru','tr','it','nl','el','hi','bn','th','vi','id','uk','pl','fa','he','sv','fi']){
  const names=new Intl.DisplayNames([locale],{type:'region'});
  for(const code of Object.keys(countryToCurrency))if(/^[A-Z]{2}$/.test(code))countryNames.set(norm(names.of(code)),code);
}
// Only provider locality entities can become planning areas. Country names and
// IANA zones determine a suggested currency; nothing here estimates exchange rates.
export function locationOption(entity){
  if(!entity?.types?.includes('urn:entity:locality')||!entity.name)return null;
  let id;try{id=locationId(entity.entity_id);}catch{return null;}
  const p=entity.properties||{},ancestor=p.ancestors?.find(a=>a.place==='country'||a.admin_level===2);
  let timeZone=null;
  try{const zones=findTimeZones(entity.location.lat,entity.location.lon??entity.location.lng);if(zones.length===1)timeZone=zones[0];}catch{}
  let countryCode=countryNames.get(norm(ancestor?.name))||countryNames.get(norm(ancestor?.abbreviation));
  // Large island regions can have a centroid at sea. Use their provider boundary
  // to recover a single consistent land time zone; ambiguous regions stay unknown.
  if(!countryCode&&(!timeZone||timeZone.startsWith('Etc/'))&&typeof p.boundaries==='string'){
    const points=[...p.boundaries.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)];
    const zones=new Set();
    for(let i=0;i<Math.min(24,points.length);i++){
      const pair=points[Math.floor(i*points.length/Math.min(24,points.length))];
      try{for(const zone of findTimeZones(Number(pair[2]),Number(pair[1])))if(!zone.startsWith('Etc/'))zones.add(zone);}catch{}
    }
    if(zones.size===1)timeZone=[...zones][0];
  }
  const zoneCountries=ct.getTimezone(timeZone)?.countries;
  if(!countryCode&&zoneCountries?.length===1)countryCode=zoneCountries[0];
  // Some IANA zones share clock rules across countries. Only use the primary
  // country when the provider explicitly names the zone's city (e.g. Tokyo).
  const zoneCity=timeZone?.split('/').at(-1)?.replaceAll('_',' ');
  const names=[entity.name,...(p.akas||[]).map(a=>a.value)];
  if(!countryCode&&zoneCity&&names.some(name=>norm(name)===norm(zoneCity)))countryCode=ct.getCountryForTimezone(timeZone)?.id;
  const country=countryCode?new Intl.DisplayNames(['en'],{type:'region'}).of(countryCode):ancestor?.name||'';
  const name=(p.akas?.find(a=>a.language==='en')?.value||entity.name).slice(0,120);
  let label=entity.disambiguation||entity.name;
  if(country&&!norm(label).includes(norm(country)))label+=`, ${country}`;
  const currency=countryCode!=='AQ'&&Intl.supportedValuesOf('currency').includes(countryToCurrency[countryCode])?countryToCurrency[countryCode]:null;
  return {id,name,label:label.slice(0,160),country,countryCode:countryCode||null,currency,timeZone,kind:p.place||'district',source:'qloo'};
}
