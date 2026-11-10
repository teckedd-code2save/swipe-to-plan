/** View-only conversation helpers. Never send UI metadata or plan snapshots as chat history. */
export function appendConversation(messages, message) {
  const previous = message.resultCard ? messages.map(({ resultCard, ...value }) => value) : messages;
  return [...previous, message].slice(-40);
}
export function conversationHistory(messages) {
  return messages.slice(-8).map(({ role, text }) => ({ role, text: text.slice(0, 1600) }));
}
export function reviewPersonId(brief, requested) {
  if (requested != null && !brief.people.some(person => person.id === requested))
    throw new Error('That person is no longer in this outing. Open Review plan and choose an existing person.');
  return requested ?? brief.people[0].id;
}
export function applyArtistInputs(people, inputs) {
  return people.map(person => {
    if (!Object.hasOwn(inputs, person.id)) return person;
    const artists = [...new Set(inputs[person.id].split(',').map(value => value.trim()).filter(Boolean))];
    if (artists.length > 6 || artists.some(value => value.length > 160))
      throw new Error(`Use up to six artists for ${person.name}, each under 160 characters.`);
    return { ...person, artists };
  });
}
export function unfilledVisitMessage(stop) {
  if (stop.unfilledReason) return stop.unfilledReason;
  return ({
    time_in_past: 'This visit falls in the past. Choose a later date or time, then find places again.',
    no_open_place: 'No matching place was reported open for this time. Try another time or area; opening hours still need confirmation.',
    no_eligible_places: 'No place met the current requirements. Try another area or adjust this visit, then search again.',
  })[stop.reason] || 'No qualifying place was returned. Try another area or adjust this visit, then search again.';
}

/** A direct result-card save always copies the completed outing, not newer unsatisfied edits. */
export function completedOutingCopy(draft) {
  if (!draft.plan) throw new Error('Find places before saving an outing.');
  const sameArea = draft.brief.locationId === draft.plan.request.locationId && draft.brief.area === draft.plan.request.area;
  const timeZone = draft.plan.timeZone || (sameArea ? draft.planningTimeZone : undefined);
  return { brief: draft.plan.request, confirmed: true, plan: draft.plan,
    ...(timeZone ? { planningTimeZone: timeZone } : {}) };
}

export function prepareReviewResponse(result, draft) {
  const brief = result.request || draft.brief;
  const context = { panel: result.panel === 'review' ? 'all' : result.panel,
    personId: reviewPersonId(brief, result.personId),
    cardIds: Array.isArray(result.cardIds) ? result.cardIds.filter(id => typeof id === 'string') : undefined };
  return { draft: { ...draft, brief }, context };
}
