// The same prerequisites govern chat-driven requests and direct draft selections.
// This is about planning state, never particular message words such as "results".
export function nextPlanningStep(brief, locationConfirmed) {
  if (!locationConfirmed) return 'location';
  if (!Array.isArray(brief?.activities) || brief.activities.length === 0) return 'activities';
  return 'research';
}

