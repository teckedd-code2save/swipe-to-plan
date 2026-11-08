// Missing retrieval evidence is not proof that the chosen venue is ineligible.
const rejectedReasons={
  excluded_by_user:'A selected place is excluded from this request.',
  permanently_closed:'Provider evidence marks a selected place as permanently closed.',
  hotel:'A selected place conflicts with the no-hotels constraint.',
  non_outing_venue:'Provider evidence does not support a selected place as an outing venue.',
  intent_not_supported:'Provider category evidence does not support a selected place for the requested activity.',
  location_not_supported:'Provider evidence does not establish a selected place in the requested area.',
  excluded_tag:'A selected place conflicts with the current venue restrictions.',
  price_unknown:'A selected place has no reported price tier to check against the current limit.',
  over_price_limit:'A selected place exceeds the current provider price-tier limit.',
};
export function selectedPlaceGap(stop){
  if(stop.item)return '';
  if(stop.reason==='selected_evidence_unavailable')return 'A selected place was not returned by this search, and compatible recent provider evidence is unavailable.';
  if(stop.reason==='selected_place_rejected')return rejectedReasons[stop.selectionEvidence?.reason]||'A selected place does not meet the current evidence checks.';
  return '';
}
export function selectionGapSummary(stops){return [...new Set(stops.map(selectedPlaceGap).filter(Boolean))].join(' ');}
