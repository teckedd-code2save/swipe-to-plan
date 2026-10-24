import {formatMoney} from './money.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={coffee:'Coffee',activity:'A little discovery',dinner:'Gather around the table',drinks:'Stay a little longer'};

const filename = title => String(title).replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,60)||'our-day';
export function daybookHtml(plan, personId) {
  const who=plan.request.people.find(p=>p.id===personId)||plan.people.find(p=>p.id===personId);
  const r=plan.request,cost=n=>formatMoney(n,r.currency);
  const threads=stop=>stop.connections.filter(e=>!personId||e.personId===personId).map(e=>{
    const preference=plan.tasteMap.nodes.find(n=>n.id===e.from),person=plan.people.find(p=>p.id===e.personId);
    return `<li><b>${escape(person?.name)} · ${escape(preference?.label)}</b><span>${escape(e.label)}${e.contribution!==undefined?` · relative contribution ${e.contribution.toFixed(2)} (not a likelihood)`:''}</span></li>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(r.title)}${who?` · ${escape(who.name)}`:''}</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f3e9;color:#34412f;font:15px/1.65 system-ui,sans-serif}main{max-width:880px;margin:auto;padding:50px 32px}.brand{font:40px Georgia,serif;letter-spacing:-2px;color:#4b633e}header{border-bottom:1px solid #d7dbc8;padding-bottom:25px}h1{font:46px/1.1 Georgia,serif;letter-spacing:-1.5px;margin:22px 0}h2{font:27px Georgia,serif;margin:0 0 8px}h3{font:21px Georgia,serif}.eyebrow{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#7e7c65}.brief{display:flex;gap:10px;flex-wrap:wrap}.brief span,.pill{border:1px solid #d8ddc9;border-radius:24px;padding:6px 12px;font-size:12px}.intro{background:#e9eddd;border-left:3px solid #8d9d6d;padding:20px 24px;margin:25px 0}.stop{display:grid;grid-template-columns:75px 1fr;gap:22px;margin-top:30px;break-inside:avoid}.time{color:#a15f3d;font-size:18px}.time small{display:block;font-size:12px;color:#8b9678}.place{background:#fffdf5;border:1px solid #e2e2d1;border-radius:12px;padding:24px}.address{color:#78866a;font-size:12px}.facts{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:12px;border-top:1px solid #e4e6d6;padding-top:14px;margin-top:16px}a{color:#955739}.threads{list-style:none;padding:0;margin:16px 0 0}.threads li{padding:8px 0;border-top:1px dashed #dfe3d1;font-size:12px}.threads b,.threads span{display:block}.threads span{font-size:11px;color:#738063}.budget{display:flex;gap:22px;flex-wrap:wrap;margin:30px 0;background:#e9eddd;padding:22px;border-radius:10px}.budget strong{font:27px Georgia,serif;display:block}.budget span{font-size:11px}.notes{margin-top:35px;padding-top:20px;border-top:1px solid #d7ddc7;font-size:12px;color:#748467}footer{font-size:10px;color:#88947b;margin-top:30px}@media(max-width:550px){main{padding:25px 18px}h1{font-size:36px}.stop{grid-template-columns:1fr;gap:8px}.time{display:flex;gap:12px;align-items:center}.place{padding:20px}}@media print{body{background:white}main{padding:0}h1{font-size:34px}.stop{break-inside:avoid}.place{background:white}a{text-decoration:none}}
</style></head><body><main><header><div class="brand">☼ unstressed.</div><p class="eyebrow">${who?`A little daybook for ${escape(who.name)}`:'Your day, ready to share'}</p><h1>${escape(r.title)}</h1><div class="brief"><span>${escape(r.date)}</span><span>${escape(r.area)}</span><span>${r.party.adults+r.party.children} people</span><span>${escape(plan.stops.find(s=>s.item)?.start||r.startTime)}–${escape(plan.stops.findLast(s=>s.item)?.end||r.endTime)} · ${escape(plan.timeZone||'destination local time')}</span></div></header><div class="intro"><b>${who?`${escape(who.name)}, you’re part of the picture.`:'Different tastes. One day together.'}</b><p>${escape(r.people.map(p=>p.name).join(' · '))}</p><p>${who?'This is everyone’s itinerary, with your own taste threads highlighted below.':'Follow the tastes that brought everyone into this itinerary.'} This download is a snapshot, not a live reservation.</p></div>${plan.stops.filter(stop=>stop.item).map(stop=>`<section class="stop"><div class="time">${stop.item?`${escape(stop.start)}<small>to ${escape(stop.end)}</small>`:'<small>Not scheduled</small>'}</div><div class="place"><p class="eyebrow">${escape(labels[stop.intent])}</p><h2>${escape(stop.item?.name||'A moment still to be found')}</h2><p class="address">${escape(stop.item?.address||'No eligible distinct place found yet.')}</p>${stop.item?.description?`<p>${escape(stop.item.description)}</p>`:''}<div class="facts"><span>${cost(plan.budget.allocations.find(a=>a.intent===stop.intent).amount)} · whole-group allowance</span>${stop.item?.links?.map?`<a href="${escape(stop.item.links.map)}" rel="noreferrer">View location ↗</a>`:''}</div>${threads(stop)?`<ul class="threads">${threads(stop)}</ul>`:who?'<p class="address">No individual taste contribution is evidenced for you at this stop.</p>':''}${stop.item&&stop.bufferAfterMinutes?`<p class="address">${stop.bufferAfterMinutes}-minute planning buffer after this stop; check actual travel time.</p>`:''}</div></section>`).join('')}<section class="budget"><div><strong>${cost(r.budget)}</strong><span>Total group allowance</span></div><div><strong>${cost(plan.budget.transport)}</strong><span>Getting around</span></div><div><strong>${cost(plan.budget.reserve)}</strong><span>Breathing room</span></div></section>${plan.budget.influences?.some(p=>p.explicit)?`<section class="notes"><h3>A little room for everyone</h3><ul>${plan.budget.influences.filter(p=>!personId||p.personId===personId).map(p=>`<li>${escape(p.name)} · ${escape(({mindful:'Keep it light',balanced:'A good balance',treat:'Make it special'})[p.style])} · ${escape(p.priority==='even'?'Across the day':labels[p.priority])}</li>`).join('')}</ul><p>Each person’s spending preference contributes equally to the reserve and activity allowances. These are budget choices, not venue price evidence.</p></section>`:''}<section class="notes"><h3>Before you head out</h3><ul>${plan.warnings.map(w=>`<li>${escape(w)}</li>`).join('')}</ul><p>Check opening hours, menus and prices, travel times, reservations and each person’s needs directly with venues. Contributions show cultural associations; they are not ratings or guarantees.</p></section><footer>Created from ${escape(plan.provenance.provider)} place data retrieved ${escape(plan.provenance.retrievedAt)}. Prepared ${escape(new Date().toISOString())}. No bookings have been made.</footer></main></body></html>`;
}
const icsEscape=value=>String(value||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');

// Convert destination wall time to an instant. Reject DST gaps and repeated hours
// rather than silently shifting a shared calendar event.
export function calendarTimestamp(date,time,zone){
  const target=`${date}T${time}:00`,naive=Date.parse(target+'Z');
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const local=instant=>{const p=Object.fromEntries(formatter.formatToParts(new Date(instant)).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;};
  const offsets=new Set();for(let hour=-36;hour<=36;hour+=6){const sample=naive+hour*3600000;offsets.add(sample-Date.parse(local(sample)+'Z'));}
  const matches=[...offsets].map(offset=>naive+offset).filter(value=>local(value)===target);
  if(matches.length!==1)throw new Error('This time falls in a daylight-saving clock change. Choose a different start time before exporting.');
  return new Date(matches[0]).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
}

export function itineraryCalendar(plan) {
  const zone=plan.timeZone||(['Accra','Osu','East Legon','Cantonments','Labone','Airport Residential'].includes(plan.request.area)?'Africa/Accra':null);
  if(!zone)throw new Error('The destination time zone could not be verified. Download the daybook, or refine the location before exporting a calendar.');
  const timestamp=time=>calendarTimestamp(plan.request.date,time,zone),cost=n=>formatMoney(n,plan.request.currency);
  const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Unstressed//Suggested day//EN','CALSCALE:GREGORIAN',...plan.stops.filter(s=>s.item).flatMap(s=>['BEGIN:VEVENT',`UID:${encodeURIComponent(s.item.id)}-${plan.request.date}-${s.intent}@outing.local`,`DTSTAMP:${stamp}`,`DTSTART:${timestamp(s.start)}`,`DTEND:${timestamp(s.end)}`,`SUMMARY:${icsEscape(`Suggested: ${s.item.name}`)}`,`LOCATION:${icsEscape(s.item.address)}`,`DESCRIPTION:${icsEscape(`${plan.request.title}. Suggested timing, not a booking. Confirm opening hours, prices, travel time and suitability. Group allowance: ${cost(plan.budget.allocations.find(a=>a.intent===s.intent).amount)}.`)}`,'STATUS:TENTATIVE','TRANSP:TRANSPARENT','END:VEVENT']),'END:VCALENDAR'];
  // Fold on UTF-8 boundaries, as required for calendar clients.
  return lines.map(line=>{let result='',part='',bytes=0;for(const char of line){const length=new TextEncoder().encode(char).length;if(bytes+length>73){result+=part+'\r\n ';part='';bytes=1;}part+=char;bytes+=length;}return result+part;}).join('\r\n')+'\r\n';
}

// Google's event-template link opens an editable draft; only the user saves it.
// https://developers.google.com/workspace/calendar/api/concepts/inviting-attendees-to-events
export function googleCalendarLink(plan){
  if(!plan?.timeZone)throw new Error('Choose a precise planning area so I can use the correct calendar time zone.');
  const stops=plan.stops.filter(s=>s.item);
  if(!stops.length)throw new Error('Find at least one place before adding your outing to Calendar.');
  const r=plan.request,url=new URL('https://calendar.google.com/calendar/r/eventedit');
  url.searchParams.set('action','TEMPLATE');
  url.searchParams.set('text',r.title);
  url.searchParams.set('dates',`${calendarTimestamp(r.date,stops[0].start,plan.timeZone)}/${calendarTimestamp(r.date,stops.at(-1).end,plan.timeZone)}`);
  url.searchParams.set('stz',plan.timeZone);url.searchParams.set('etz',plan.timeZone);
  url.searchParams.set('location',stops.length===1?`${stops[0].item.name}, ${stops[0].item.address}`:r.area);
  url.searchParams.set('details',[
    'Planned with Unstressed',`Times at destination: ${plan.timeZone}`,'',
    ...stops.flatMap(s=>[`${s.start}–${s.end} · ${s.item.name}`,s.item.address||'',s.item.links?.map||'','']),
    `Group allowance: ${formatMoney(r.budget,r.currency)}. Allowances are not venue quotes.`,
    'Suggested itinerary, not a booking. Confirm hours, prices, travel and any specific needs with the venues.',
    'This is a snapshot. Later changes in Unstressed will not update this event.',
  ].join('\n'));
  return url.href;
}
export function downloadDay(plan,personId,calendar=false) {
  const person=plan.people.find(p=>p.id===personId);
  const blob=new Blob([calendar?itineraryCalendar(plan):daybookHtml(plan,personId)],{type:calendar?'text/calendar;charset=utf-8':'text/html;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`unstressed-${filename(plan.request.title)}${person?`-${filename(person.name)}`:''}.${calendar?'ics':'html'}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
