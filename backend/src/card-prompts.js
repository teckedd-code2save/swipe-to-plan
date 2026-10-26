import {InputError} from './contract.js';
import {publicDeck} from './deck.js';
export function parseCardPrompts(value,ids=[]){
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>8||new Set(value.map(p=>p?.id)).size!==value.length)throw new InputError('Use one contextual prompt per suggested card.');
  return value.map(p=>{
    if(!p||Object.keys(p).some(k=>!['id','label','sub'].includes(k))||!ids.includes(p.id)||!publicDeck().some(c=>c.id===p.id)||typeof p.label!=='string'||!p.label.trim()||p.label.length>64||typeof p.sub!=='string'||!p.sub.trim()||p.sub.length>140||/[\x00-\x1f<>]/.test(p.label+p.sub))throw new InputError('Choose valid contextual card prompts for the suggested cards.');
    return {id:p.id,label:p.label.trim(),sub:p.sub.trim()};
  });
}
