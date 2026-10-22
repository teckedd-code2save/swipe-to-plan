// Intentionally synthetic fixtures for local development. No calls, keys or database.
export const demoPlaces = [
  ["coffee-1", "Sample Garden Café", "Osu", ["cafe", "african"], 1],
  ["coffee-2", "Sample Music Café", "Osu", ["cafe", "live_music"], 2],
  ["dinner-1", "Sample Rooftop Kitchen", "Osu", ["restaurant", "rooftop", "african"], 2],
  ["drinks-1", "Sample Listening Bar", "Osu", ["bar", "live_music"], 2],
  ["coffee-3", "Sample Reading Café", "Osu", ["cafe"], 1],
  ["dinner-2", "Sample Courtyard Kitchen", "Labone", ["restaurant", "african"], 2],
  ["coffee-4", "Sample Morning Café", "Labone", ["cafe"], 1],
  ["dinner-3", "Sample Terrace Restaurant", "East Legon", ["restaurant", "rooftop"], 3],
  ["drinks-2", "Sample Dance Club", "Osu", ["nightclub", "dance_club"], 2],
  ["coffee-5", "Sample Corner Café", "Cantonments", ["cafe"], null],
  ["hotel-1", "Sample Hotel", "Osu", ["hotel", "restaurant"], 3],
  ["wrong-city", "Sample Kumasi Café", "Kumasi", ["cafe"], 1],
].map(([id, name, area, tags, price]) => ({
  entity_id: id, name,
  tags: tags.map((tag) => ({ id: `urn:tag:category:qloo:${tag}`, name: tag.replaceAll("_", " ") })),
  properties: { address: area === "Kumasi" ? "Kumasi, Ghana" : `${area}, Accra, Ghana`, ...(price ? { price_level: price } : {}) },
}));
export function createDemoProvider() {
  return {
    name: "demo",
    async resolveArtist(name) {
      if (name.toLowerCase() === "unknown") return { status: "unresolved", reason: "no_exact_artist_match" };
      return { status: "resolved", entityId: `sample-${name.toLowerCase().replace(/[^a-z]/g, "")}`, name };
    },
    async discover({ signalIds }) {
      const places = structuredClone(demoPlaces);
      return signalIds.length ? [...places.slice(2), ...places.slice(0, 2)] : places;
    },
  };
}
