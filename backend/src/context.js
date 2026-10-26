import {InputError} from './contract.js';
import {INTEREST_TYPES} from '../../shared/research-context.js';

export const AUDIENCE_FAMILIES=['professional_area','hobbies_and_interests','leisure','life_stage'];
export const validAudience=id=>typeof id==='string'&&/^urn:audience:[a-z_]+:[a-z0-9_]+$/.test(id)&&AUDIENCE_FAMILIES.includes(id.split(':')[2]);
const text=(value,max,label)=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f<>]/.test(value))throw new InputError(`Check ${label}.`);return value.trim();};
const object=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw new InputError('Check the personal context fields.');};
export function parseContext(value){
  if(value===undefined)return undefined;
  object(value,['role','roleQuote','audiences','interests']);
  const result={};
  if(value.role!==undefined&&value.role!=='')result.role=text(value.role,80,'your work or life context');
  if(value.roleQuote!==undefined)result.roleQuote=text(value.roleQuote,200,'the disclosed context');
  if(value.audiences!==undefined){if(!Array.isArray(value.audiences)||value.audiences.length>3||value.audiences.some(id=>!validAudience(id)))throw new InputError('Choose supported Qloo audience references.');if(value.audiences.length)result.audiences=[...new Set(value.audiences)];}
  if(value.interests!==undefined){
    if(!Array.isArray(value.interests)||value.interests.length>6)throw new InputError('Keep up to six cultural interests.');
    const interests=value.interests.map(i=>{object(i,['type','name','quote']);if(!INTEREST_TYPES.includes(i.type))throw new InputError('Choose a supported cultural interest type.');return {type:i.type,name:text(i.name,160,'the interest name'),...(i.quote?{quote:text(i.quote,200,'the disclosed interest')}:{} )};});
    if(interests.length)result.interests=[...new Map(interests.map(i=>[i.type+':'+i.name.toLowerCase(),i])).values()];
  }
  return Object.keys(result).length?result:undefined;
}
const normalized=value=>String(value||'').toLowerCase().replace(/\s+/g,' ').trim();
export function validateDisclosures(people,previous,message,history,catalog){
  const utterances=[message,...history.filter(t=>t.role==='user').map(t=>t.text)].map(normalized);
  const quoted=quote=>!!quote&&utterances.some(text=>text.includes(normalized(quote)));
  for(const person of people||[]){
    const context=person.context;if(!context)continue;
    const old=previous?.find(p=>p.id===person.id)?.context||{};
    if(context.role&&context.role!==old.role&&!quoted(context.roleQuote))throw new InputError('Use a short quote from the person’s own words for new work or life context.');
    for(const interest of context.interests||[])if(!(old.interests||[]).some(i=>i.type===interest.type&&normalized(i.name)===normalized(interest.name))&&!quoted(interest.quote))throw new InputError('New cultural interests need a quote from the person, not an inferred preference.');
    for(const id of context.audiences||[])if(!(old.audiences||[]).includes(id)&&(!catalog.some(a=>a.id===id)||!quoted(context.roleQuote)&&!(context.interests||[]).some(i=>quoted(i.quote))))throw new InputError('Resolve a disclosed context to an exact audience from the supplied Qloo catalog. Do not invent audience IDs.');
  }
}
export function rememberedContext(context){
  if(!context)return undefined;
  return parseContext({...(context.role?{role:context.role}:{}),...(context.audiences?.length?{audiences:context.audiences}:{}),...(context.interests?.length?{interests:context.interests.map(({type,name})=>({type,name}))}:{})});
}
