// Explicit UI shortcuts only. This does not infer dates, budgets, tastes or membership.
const circleWords=new Set(['circle','circles','curcle','curcles']);
const groupWords=new Set(['group','groups','geoup','friends','fruends']);
export function requestedGroupControl(message,{hasGroup=false}={}){
  const words=String(message).toLowerCase().match(/[\p{L}]+/gu)||[];
  if(words.some(word=>['solo','alone','myself'].includes(word)))return null;
  const circle=words.some(word=>circleWords.has(word)),group=words.some(word=>groupWords.has(word));
  const edit=words.some(word=>['add','invite','choose','pick','change','switch','remove'].includes(word));
  if(hasGroup&&!edit)return null;
  if(circle)return 'circles';
  if(group||(words.includes('people')&&edit))return 'people';
  return null;
}
