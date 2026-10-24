import {identity,hasTaste,updateRoster} from './day-state.js';
const KEY='outing.circles.v1';
const valid=p=>p&&typeof p.id==='string'&&typeof p.name==='string'&&Array.isArray(p.artists)&&Array.isArray(p.vibes);
export function readCircles(){try{const data=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(data)?data.filter(c=>c.id&&typeof c.name==='string'&&Array.isArray(c.people)&&c.people.length&&c.people.every(valid)).slice(0,12):[];}catch{return [];}}
export function writeCircles(circles){localStorage.setItem(KEY,JSON.stringify(circles.slice(0,12)));return circles.slice(0,12);}
export function makeCircle(name,people){if(!name.trim())throw new Error('Give your circle a name.');return {id:identity(),name:name.trim().slice(0,40),people:people.map(({id,name,artists,vibes,spending})=>({id,name,artists:[...artists],vibes:[...vibes],...(spending?{spending:{...spending}}:{})}))};}
export function circlePeople(circle,contacts){return circle.people.map(p=>circle.accountIds?.includes(p.id)?p:contacts.find(c=>c.id===p.id)||p);}
export function bringCircle(brief,circle,contacts=[]){
  const people=circlePeople(circle,contacts);
  const placeholder=brief.people.length===1&&brief.people[0].name==='You'&&!hasTaste(brief.people[0]);
  const current=placeholder?[]:brief.people;
  const merged=[...current,...people.filter(p=>!current.some(c=>c.id===p.id))];
  if(merged.length>6)throw new Error('This day has room for six taste profiles. Remove someone before bringing this circle.');
  return updateRoster(brief,merged);
}
