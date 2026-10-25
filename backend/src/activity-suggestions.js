import {publicDeck} from './deck.js';
// Retrieval categories are suggestions based on chosen cards, not new tastes.
export function suggestedActivities(people,party) {
  const cards=new Map(publicDeck().map(c=>[c.id,c])),votes=new Map();
  for(const person of people){
    const intents=new Set(person.vibes.map(id=>id==='v-cafe'||id==='v-bakery'?'coffee':['v-bar','v-club'].includes(id)?'drinks':cards.get(id)?.group==='food'?'dinner':cards.get(id)?.group==='activity'?'activity':null).filter(i=>i&&!(party.children&&i==='drinks')));
    for(const intent of intents)votes.set(intent,(votes.get(intent)||0)+1/intents.size);
  }
  const order=['coffee','activity','dinner','drinks'];
  return (votes.size?[...votes].sort((a,b)=>b[1]-a[1]||order.indexOf(a[0])-order.indexOf(b[0])).slice(0,2).map(([i])=>i):['activity']).sort((a,b)=>order.indexOf(a)-order.indexOf(b));
}
