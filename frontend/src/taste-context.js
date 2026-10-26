// Ordering is a suggestion, not a vote or a newly inferred preference.
export function tailorTasteCards(deck,person,category,cardIds=[]) {
  const rank=new Map(cardIds.map((id,index)=>[id,index]));
  const chosen=card=>card.kind==='artist'?person.artists.includes(card.label):person.vibes.includes(card.id);
  return deck.filter(card=>category==='request'?rank.has(card.id):(card.group||(card.kind==='artist'?'music':'mood'))===category)
    .map((card,index)=>({card,index})).sort((a,b)=>(rank.get(a.card.id)??1000)-(rank.get(b.card.id)??1000)||Number(chosen(a.card))-Number(chosen(b.card))||a.index-b.index).map(({card})=>card);
}

export function contextualCardCopy(deck,prompts=[]){
  const copy=new Map(prompts.map(prompt=>[prompt.id,prompt]));
  return deck.map(card=>copy.has(card.id)?{...card,promptLabel:copy.get(card.id).label,promptSub:copy.get(card.id).sub}:card);
}
