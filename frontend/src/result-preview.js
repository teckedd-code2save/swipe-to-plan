import {comparisonKey,decisionStops} from './decision-evidence.js';
import {partialPlanSummary} from './plan-assistance.js';
import {venueMentions} from './venue-mentions.js';

// A presentation identity, never a replacement for the ordered itinerary. In
// particular, two visits to one venue and a missing stop must remain distinct.
export const recommendationKey = plan => plan ? comparisonKey(plan,decisionStops(plan).slice(0,4)) : '';

// Only automatically generated comparison turns use this preview. Never shorten
// a direct answer, user message, permission request or error. Preserve the exact
// complete sentence, rather than clipping words or inventing a new conclusion;
// the unchanged comparison is available beside the full results.
export function comparisonPreviewText(text,plan) {
  const full=text?.trim()||'';
  if(full.length<=420)return full;
  const stops=decisionStops(plan);
  const sentences=full.split(/(?<=[.!?])\s+|\n\s*\n/u);
  const incomplete=/\b(?:approx|e\.g|i\.e|vs|Dr|Mr|Mrs|Ms|Prof|St|Mt|No|Inc|Ltd|Co|a\.m|p\.m|[A-Z])\.$/i;
  return sentences.find(sentence=>sentence.length<=320&&!incomplete.test(sentence)&&venueMentions(sentence,stops).some(part=>part.stop))||'';
}

export function resultPreview(plan) {
  if(!plan)return null;
  const missing=plan.stops.some(stop=>!stop.item);
  const timing=plan.phase==='needs_timing'?'Visit times need adjusting.':plan.phase==='discovery'?'Visit times are not set.':'';
  const gap=partialPlanSummary(plan);
  const warnings=[...new Set([gap,timing,...(plan.warnings||[])].filter(Boolean))];
  return {
    title:!plan.stops.some(stop=>stop.item)?'Places still to find':missing?'Your outing so far':'Suggested for your outing',
    stops:plan.stops,
    warnings,
    // Nearby alternatives do not fill the requested visits.
    alternatives:!plan.stops.some(stop=>stop.item)?(plan.nearbySuggestions||[]):[],
  };
}
