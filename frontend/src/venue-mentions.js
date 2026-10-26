// Link only complete names from this outing; model-generated URLs are never trusted.
export function venueMentions(text,stops=[]){
 const candidates=stops.filter(s=>s.item?.name&&s.item?.entityId).sort((a,b)=>b.item.name.length-a.item.name.length);
 const lower=text.toLocaleLowerCase(),parts=[];let start=0,index=0;
 const word=c=>c&&/[\p{L}\p{N}]/u.test(c);
 while(index<text.length){const stop=candidates.find(s=>lower.startsWith(s.item.name.toLocaleLowerCase(),index)&&!word(text[index-1])&&!word(text[index+s.item.name.length]));if(!stop){index++;continue;}if(index>start)parts.push({text:text.slice(start,index)});parts.push({text:text.slice(index,index+stop.item.name.length),stop});index+=stop.item.name.length;start=index;}
 if(start<text.length)parts.push({text:text.slice(start)});return parts;
}
