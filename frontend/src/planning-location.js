// A saved default supplies context for a fresh outing, never a replacement for
// an explicit location in an existing, shared or restored outing.
export function withPreferredLocation(brief, preferred) {
  if (brief.area || brief.locationId || !preferred?.id || !preferred.label) return brief;
  const currency = brief.currencyMode === 'custom' ? brief.currency : preferred.currency;
  if (!currency) return brief; // The location picker must ask for a currency first.
  return { ...brief, area: preferred.label, locationId: preferred.id, currency, currencyMode: brief.currencyMode || 'local' };
}
