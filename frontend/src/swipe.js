export function swipeDirection(dx, dy, width) {
  const threshold = Math.min(80, Math.max(40, width * 0.14));
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.2) return null;
  return dx > 0 ? 'like' : 'skip';
}
export function decideCard(history, deck, like) {
  const card = deck[history.length];
  return card ? [...history, { id: card.id, like }] : history;
}
export const undoCard = (history) => history.slice(0, -1);
export const likedCards = (history) => history.filter((h) => h.like).map((h) => h.id);
