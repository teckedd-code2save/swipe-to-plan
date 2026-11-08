// Missing provenance on an existing name is deliberately unknown, not inferred
// from its wording. Only an explicit name edit may turn it into a custom title.
export const TITLE_SOURCES = ['auto', 'custom', 'legacy'];
export const titleSource = request => request.titleSource ?? (typeof request.title === 'string' && request.title.trim() ? 'legacy' : 'auto');
export const editPlanTitle = title => ({title, titleSource: title.trim() ? 'custom' : 'auto'});

export function planTitle(request) {
  if (typeof request.title === 'string' && request.title.trim()) return request.title.trim();
  const labels = {coffee:'Coffee',activity:'A little exploring',dinner:'A good meal',drinks:'Drinks'};
  const activities = (request.activities || []).map(key => labels[key]).filter(Boolean);
  const area = request.area?.split(',')[0]?.trim();
  return `${activities.length?activities.map((label,index)=>index?label.charAt(0).toLowerCase()+label.slice(1):label).join(' & '):request.party?.children?'Family time':'An outing'}${area?` in ${area}`:''}`.slice(0,80);
}
