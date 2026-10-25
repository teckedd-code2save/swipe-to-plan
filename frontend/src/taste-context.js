// Ordering is a suggestion, not a vote or a newly inferred preference.
export function tailorTasteCards(deck,person,category,cardIds=[]) {
  const rank=new Map(cardIds.map((id,index)=>[id,index]));
  const chosen=card=>card.kind==='artist'?person.artists.includes(card.label):person.vibes.includes(card.id);
  return deck.filter(card=>(card.group||(card.kind==='artist'?'music':'mood'))===category)
    .map((card,index)=>({card,index})).sort((a,b)=>(rank.get(a.card.id)??1000)-(rank.get(b.card.id)??1000)||Number(chosen(a.card))-Number(chosen(b.card))||a.index-b.index).map(({card})=>card);
}
