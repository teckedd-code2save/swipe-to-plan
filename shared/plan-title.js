const placeholders = /^(?:an outing|a day out|a day together|family day|a little day,? beautifully spent|one place,? well chosen|your day|your outing)$/i;
export const isPlaceholderTitle = title => !title?.trim() || placeholders.test(title.trim());
export function planTitle(request) {
  if (!isPlaceholderTitle(request.title)) return request.title.trim();
  const labels = {coffee:'Coffee',activity:'A little exploring',dinner:'A good meal',drinks:'Drinks'};
  const activities = (request.activities || []).map(key => labels[key]).filter(Boolean);
  const area = request.area?.split(',')[0]?.trim();
  return `${activities.length?activities.map((label,index)=>index?label.charAt(0).toLowerCase()+label.slice(1):label).join(' & '):request.party?.children?'Family time':'An outing'}${area?` in ${area}`:''}`.slice(0,80);
}
