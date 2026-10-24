import React from 'react';

export function Icon({name,size=20,...props}) {
  const paths={
    download:<><path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6"/></>,
    plus:<path d="M12 5v14M5 12h14"/>,arrow:<path d="M5 12h14m-5-5 5 5-5 5"/>,up:<path d="M12 19V5m-6 6 6-6 6 6"/>,close:<path d="m6 6 12 12M6 18 18 6"/>,check:<path d="m5 12 4 4 10-10"/>,
    pin:<><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    calendar:<><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-12 4h3"/></>,
    people:<><circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/></>,
    wallet:<><rect x="3" y="6" width="18" height="15" rx="3"/><path d="M3 8V5a2 2 0 0 1 2-2h12m4 9h-6v5h6m-3-2.5h.01"/></>,
    clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    map:<><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Zm6-3v15m6-12v15"/></>,
    nodes:<><circle cx="5" cy="5" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="19" r="2"/><path d="m7 6 10 5M7 18l10-5M5 7v10"/></>,
    list:<><path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/></>,
    coffee:<><path d="M3 8h13v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5Zm13 1h2a3 3 0 1 1 0 6h-2M6 3v2m4-2v2"/></>,
    activity:<><path d="m3 9 9-6 9 6H3Zm2 3v7m7-7v7m7-7v7M3 22h18"/></>,
    dinner:<><path d="M5 3v7m4-7v7M3 3v5a4 4 0 0 0 8 0V3M7 12v9M20 3c-4 1-5 6-5 10h5m0-10v18"/></>,
    drinks:<><path d="m4 3 8 10 8-10H4Zm8 10v8m-5 0h10M7 7h10"/></>,
    bookmark:<path d="M6 3h12v18l-6-4-6 4V3Z"/>,copy:<><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
    edit:<><path d="m14 5 5 5M4 20l5-1L21 7l-5-5L4 14v6Z"/></>,undo:<><path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12"/></>,
    lock:<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/></>,
    arrowUpRight:<path d="M6 18 18 6M6 6h12v12"/>,menu:<path d="M4 6h16M4 12h16M4 18h16"/>,music:<><path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/></>,
    info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/></>,leaf:<><path d="M20 3C8 2 2 8 6 16s14 4 14-13ZM5 21 16 9"/></>,print:<><path d="M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6Z"/></>,trash:<><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]||paths.arrow}</svg>;
}
export function Sun({size=32}) {return <svg className="outing-sun" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round"><circle cx="20" cy="20" r="7"/>{Array.from({length:12},(_,i)=><path key={i} d="M20 3v4" transform={`rotate(${i*30} 20 20)`}/>)}</g></svg>;}
export const PERSON_COLORS=['#bb613b','#5b7b65','#7768a8','#b18a35','#427e91','#a6687b'];
export const ACTIVITY_NAMES={coffee:'Coffee',activity:'Discovery',dinner:'A good meal',drinks:'Drinks'};
export {money,formatMoney} from './money.js';
export const dateLabel=(date)=>new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'});
