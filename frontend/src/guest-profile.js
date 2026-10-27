const KEY='unstressed.guest-profile.v1';
export function readGuestProfile(storage=globalThis.localStorage){
  try{const p=JSON.parse(storage.getItem(KEY)||'null');if(!p||!Array.isArray(p.artists)||!Array.isArray(p.vibes))return null;return {name:'You',artists:p.artists.filter(v=>typeof v==='string').slice(0,6),vibes:p.vibes.filter(v=>typeof v==='string').slice(0,18),...(p.spending?{spending:p.spending}:{})};}catch{return null;}
}
export function saveGuestProfile(person,storage=globalThis.localStorage){
  try{storage.setItem(KEY,JSON.stringify({artists:person.artists,vibes:person.vibes,...(person.spending?{spending:person.spending}:{})}));return true;}catch{return false;}
}
