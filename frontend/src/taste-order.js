// A card fan lets people vote on any visible card. Move only that card
// into the next decision slot; never cast votes on cards above it.
export function bringCardToFront(cards,decidedCount,id){
  const index=cards.findIndex(card=>card.id===id);
  if(index<decidedCount)return cards;
  return [...cards.slice(0,decidedCount),cards[index],...cards.slice(decidedCount).filter(card=>card.id!==id)];
}
