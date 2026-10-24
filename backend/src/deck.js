// A starting set, not an artist allowlist. Any supplied artist can resolve through Qloo.
// Food/activity preferences become Qloo tag signals and evidence-based boosts.
// Vibe regexes are matched against each place's Qloo tag ids (e.g. urn:tag:setting:qloo:rooftop).
const artist = (id, label, sub, emoji) => ({ id: `a-${id}`, kind: "artist", group:'music', label, sub, emoji, query: label });
const vibe = (id, label, sub, emoji, re, group='mood') => ({ id: `v-${id}`, kind: "vibe", group, label, sub, emoji, re, rx: new RegExp(re) });

export const DECK = [
  artist('sza','SZA','R&B / soul','🌙'),
  artist('badbunny','Bad Bunny','Reggaeton / Latin trap','🌴'),
  artist("sarkodie", "Sarkodie", "Hip-hop / hiplife", "🎤"),
  artist('bts','BTS','K-pop','💜'),
  artist('tyla','Tyla','Pop / amapiano','💧'),
  artist("blacksherif", "Black Sherif", "Drill meets highlife", "🔥"),
  vibe("rooftop", "Rooftop sunsets", "Views and golden hour", "🌇", "rooftop"),
  artist("amaarae", "Amaarae", "Alt R&B / experimental", "🪩"),
  artist('billie','Billie Eilish','Alternative pop','🌌'),
  artist('arijit','Arijit Singh','Indian film music / pop','🎼'),
  artist("kojoantwi", "Kojo Antwi", "Smooth highlife", "🎷"),
  vibe("livemusic", "Live music", "A band on the night", "🎶", "live_music"),
  artist("burna", "Burna Boy", "Afro-fusion", "🌍"),
  artist('taylor','Taylor Swift','Pop / singer-songwriter','✨'),
  artist("tems", "Tems", "Soulful Afrobeats", "🌙"),
  vibe("african", "African cuisine", "Familiar flavors, a table to share", "🍲", "african",'food'),
  artist("stonebwoy", "Stonebwoy", "Afro-dancehall", "🎧"),
  artist('rosalia','ROSALÍA','Pop / flamenco influences','🌹'),
  artist('daftpunk','Daft Punk','Electronic / French house','🪩'),
  artist("kingpromise", "King Promise", "Afrobeats romance", "💛"),
  vibe("cafe", "Cozy cafés", "Coffee and slow mornings", "☕", "cafe|coffee"),
  artist("shatta", "Shatta Wale", "Dancehall energy", "👑"),
  artist('adele','Adele','Pop / soul','🎙️'),
  artist("asake", "Asake", "Street-pop Afrobeats", "🥁"),
  vibe("bar", "Cocktail bars", "Low light, good drinks", "🍸", "(^|[:_])(cocktail_)?bar($|[:_])"),
  artist("wizkid", "Wizkid", "Afrobeats royalty", "⭐"),
  artist('blackpink','BLACKPINK','K-pop','🖤'),
  artist('bobmarley','Bob Marley','Reggae','☀️'),
  artist("beyonce", "Beyoncé", "Global pop", "🐝"),
  artist("kendrick", "Kendrick Lamar", "Lyrical hip-hop", "📝"),
  artist('radiohead','Radiohead','Alternative rock','📻'),
  artist('ninasimone','Nina Simone','Jazz / soul','🎹'),
  vibe("club", "Late-night spots", "Dancing till late", "🪩", "night_?club|nightlife|dance_club"),
  artist("daddylumba", "Daddy Lumba", "Highlife legend", "🎙️"),
  artist('milesdavis','Miles Davis','Jazz','🎺'),
  artist('anitta','Anitta','Brazilian pop / funk','💃'),
  artist('nujabes','Nujabes','Jazz rap / instrumental hip-hop','🎧'),
  artist('yoyoma','Yo-Yo Ma','Classical / cello','🎻'),
  vibe('ghanaian','Ghanaian favorites','Something that tastes like home','🍛','(^|[:_])ghanaian($|[:_])','food'),
  vibe('seafood','Seafood','Fresh from the coast','🐟','(^|[:_])seafood($|[:_])','food'),
  vibe('italian','Italian food','Pasta, pizza, a long lunch','🍝','(^|[:_])(italian|pizza|pizzeria)($|[:_])','food'),
  vibe('asian','Asian flavors','A little spice, a little discovery','🥢','(^|[:_])(asian|chinese|japanese|thai|korean|vietnamese|sushi)($|[:_])','food'),
  vibe('plant','Plant-forward','More vegetables on the table','🥗','(^|[:_])(vegetarian|vegan|plant_based)($|[:_])','food'),
  vibe('grill','Grills & barbecue','Smoke, fire, something hearty','🔥','(^|[:_])(barbecue|bbq|grill|steakhouse)($|[:_])','food'),
  vibe('bakery','Bakes & sweet things','A small, delicious detour','🥐','(^|[:_])(bakery|patisserie|dessert|ice_cream)($|[:_])','food'),
  vibe('art','Art & galleries','Find something that makes you look twice','🎨','(^|[:_])(art_gallery|art_museum|arts_center|arts_centre)($|[:_])','activity'),
  vibe('nature','Parks & gardens','A little room to breathe','🌿','(^|[:_])(park|garden|gardens|botanical)($|[:_])','activity'),
  vibe('history','Museums & history','Stories you can step into','🏛️','(^|[:_])(museum|monument|memorial|historical|historic)($|[:_])','activity'),
  vibe('beach','Beach time','Salt air and a slower afternoon','🌊','(^|[:_])beach($|[:_])','activity'),
  vibe('markets','Markets & local finds','Browse, wander, find a little treasure','🧺','(^|[:_])(market|marketplace|craft_market|flea_market)($|[:_])','activity'),
  vibe('books','Books & browsing','Follow your curiosity down an aisle','📚','(^|[:_])(bookstore|bookshop|library)($|[:_])','activity'),
];

const tagQueries={african:'african',ghanaian:'ghanaian',seafood:'seafood',italian:'italian',asian:'asian',plant:'vegetarian',grill:'barbecue',bakery:'bakery',art:'art gallery',nature:'park',history:'museum',beach:'beach',markets:'market',books:'bookstore'};
for(const card of DECK)if(tagQueries[card.id.slice(2)])card.tagQuery=tagQueries[card.id.slice(2)];

export const byId = Object.fromEntries(DECK.map((c) => [c.id, c]));
export function matchesTasteTag(card,id){
  if(!card?.rx||!card.rx.test(id))return false;
  if(card.group==='activity')return /^urn:tag:(category|genre):(place|qloo):[^:]+$/.test(id);
  if(card.group==='food')return /^urn:tag:(category|genre|cuisine|culinary_style):(place|qloo):/.test(id)&&!/:hotel:/.test(id);
  return true;
}
export const publicDeck = () => DECK.map(({ re, rx, query, tagQuery, ...c }) => c);
