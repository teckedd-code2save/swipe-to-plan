export const displayMenuPrice=item=>`${item.currency} ${item.price.toFixed(2)}`;
export function selectedMenuTotal(picks,currency){
 const matching=picks.filter(p=>p.currency===currency&&Number.isFinite(p.price)&&p.price>0);
 return {amount:Math.round(matching.reduce((sum,p)=>sum+p.price,0)*100)/100,priced:matching.length,unpriced:picks.length-matching.length};
}
export function pricedMenuSelections(picks,evidenceByPlace){
 return picks.map(pick=>{
  const matches=(evidenceByPlace.get(pick.placeId)?.items||[]).filter(item=>item.name.trim().toLowerCase()===pick.label.trim().toLowerCase());
  if(matches.length!==1)return pick;
  const item=matches[0];return {...pick,price:item.price,currency:item.currency,sourceUrl:item.sourceUrl,menuKey:`${item.name.toLowerCase()}|${item.currency}|${item.price}`};
 });
}
