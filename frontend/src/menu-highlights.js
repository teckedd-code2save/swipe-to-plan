export function menuHighlights(values=[]){
 const seen=new Set();return values.flatMap(value=>{if(typeof value!=='string')return [];const label=value.trim().replace(/\s+/g,' '),key=label.toLocaleLowerCase();if(!label||seen.has(key))return [];seen.add(key);return [{key,label}];});
}
