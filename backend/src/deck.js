// The swipe deck. Artists become Qloo entity signals; vibes become tag boosts on results.
// Vibe regexes are matched against each place's Qloo tag ids (e.g. urn:tag:setting:qloo:rooftop).
const artist = (id, label, sub, emoji) => ({ id: `a-${id}`, kind: "artist", label, sub, emoji, query: label });
const vibe = (id, label, sub, emoji, re) => ({ id: `v-${id}`, kind: "vibe", label, sub, emoji, re, rx: new RegExp(re) });

export const DECK = [
  artist("sarkodie", "Sarkodie", "Hip-hop / hiplife", "🎤"),
  artist("blacksherif", "Black Sherif", "Drill meets highlife", "🔥"),
  vibe("rooftop", "Rooftop sunsets", "Views and golden hour", "🌇", "rooftop"),
  artist("amaarae", "Amaarae", "Alt R&B / experimental", "🪩"),
  artist("kojoantwi", "Kojo Antwi", "Smooth highlife", "🎷"),
  vibe("livemusic", "Live music", "A band on the night", "🎶", "live_music"),
  artist("burna", "Burna Boy", "Afro-fusion", "🌍"),
  artist("tems", "Tems", "Soulful Afrobeats", "🌙"),
  vibe("african", "African cuisine", "Jollof, banku, grills", "🍲", "african"),
  artist("stonebwoy", "Stonebwoy", "Afro-dancehall", "🎧"),
  artist("kingpromise", "King Promise", "Afrobeats romance", "💛"),
  vibe("cafe", "Cozy cafés", "Coffee and slow mornings", "☕", "cafe|coffee"),
  artist("shatta", "Shatta Wale", "Dancehall energy", "👑"),
  artist("asake", "Asake", "Street-pop Afrobeats", "🥁"),
  vibe("bar", "Cocktail bars", "Low light, good drinks", "🍸", "(^|[:_])(cocktail_)?bar($|[:_])"),
  artist("wizkid", "Wizkid", "Afrobeats royalty", "⭐"),
  artist("beyonce", "Beyoncé", "Global pop", "🐝"),
  artist("kendrick", "Kendrick Lamar", "Lyrical hip-hop", "📝"),
  vibe("club", "Late-night spots", "Dancing till late", "🪩", "night_?club|nightlife|dance_club"),
  artist("daddylumba", "Daddy Lumba", "Highlife legend", "🎙️"),
];

export const byId = Object.fromEntries(DECK.map((c) => [c.id, c]));
export const publicDeck = () => DECK.map(({ re, rx, query, ...c }) => c);
