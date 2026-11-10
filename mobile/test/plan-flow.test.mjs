import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { appendConversation, conversationHistory, reviewPersonId, prepareReviewResponse, applyArtistInputs, completedOutingCopy, unfilledVisitMessage } from '../src/plan-flow.js';
import { newBrief } from '../src/planning.js';

test('new results have one inline anchor, and later replies stay after the result', () => {
  let messages = appendConversation([], { role: 'assistant', text: 'First plan', resultCard: true });
  messages = appendConversation(messages, { role: 'user', text: 'Change the timing' });
  messages = appendConversation(messages, { role: 'assistant', text: 'Revised plan', resultCard: true });
  assert.equal(messages.filter(message => message.resultCard).length, 1);
  assert.equal(messages[0].resultCard, undefined);
  messages = appendConversation(messages, { role: 'assistant', text: 'This reply remains visible' });
  assert.equal(messages[2].resultCard, true);
  assert.equal(messages.at(-1).text, 'This reply remains visible');
});
test('bounded conversation drops old anchors safely and sends no presentation metadata', () => {
  let messages = [{ role: 'assistant', text: 'Old outing', resultCard: true }];
  for (let i = 0; i < 45; i++) messages = appendConversation(messages, { role: 'user', text: 'x'.repeat(1700) });
  assert.equal(messages.length, 40);
  assert.equal(messages.some(message => message.resultCard), false);
  const history = conversationHistory([...messages, { role: 'assistant', text: 'Latest', resultCard: true, privatePlan: { people: ['secret'] } }]);
  assert.equal(history.length, 8);
  assert.equal(history[0].text.length, 1600);
  assert.deepEqual(history.at(-1), { role: 'assistant', text: 'Latest' });
});
test('targeted review resolves the exact existing person and never silently edits someone else', () => {
  const brief = { ...newBrief(), people: [{ id: 'you', name: 'You', artists: [], vibes: [] }, { id: 'sam', name: 'Sam', artists: ['Sade'], vibes: [] }] };
  assert.equal(reviewPersonId(brief, 'sam'), 'sam');
  assert.equal(reviewPersonId(brief), 'you');
  assert.throws(() => reviewPersonId(brief, 'missing'), /no longer in this outing/);
  assert.throws(() => reviewPersonId(brief, 'Sam'), /no longer in this outing/);
});
test('switching people preserves independent unsaved artists and all other profile fields', () => {
  const people = [
    { id: 'you', name: 'You', artists: ['Sade'], vibes: ['calm'], context: { role: 'friend' } },
    { id: 'sam', name: 'Sam', artists: ['Tems'], vibes: ['outside'], spending: { style: 'balanced', priority: 'food' } },
  ];
  const before = structuredClone(people);
  const changed = applyArtistInputs(people, { you: ' Sade, Amaarae, Sade ', sam: 'Tems, Burna Boy' });
  assert.deepEqual(changed[0].artists, ['Sade', 'Amaarae']);
  assert.deepEqual(changed[1].artists, ['Tems', 'Burna Boy']);
  assert.deepEqual(changed[0].context, people[0].context);
  assert.deepEqual(changed[1].spending, people[1].spending);
  assert.deepEqual(people, before);
  assert.deepEqual(applyArtistInputs(people, { sam: '' })[0], people[0]);
  assert.deepEqual(applyArtistInputs(people, { sam: '' })[1].artists, []);
  assert.throws(() => applyArtistInputs(people, { sam: 'a,b,c,d,e,f,g' }), /six artists for Sam/);
  assert.throws(() => applyArtistInputs(people, { sam: 'x'.repeat(161) }), /160 characters/);
  assert.deepEqual(people, before);
});
test('empty visits explain actual reasons and do not invent venues or open-hours certainty', () => {
  assert.match(unfilledVisitMessage({ reason: 'time_in_past' }), /later date or time/);
  assert.match(unfilledVisitMessage({ reason: 'no_open_place' }), /reported open/);
  assert.match(unfilledVisitMessage({ reason: 'no_open_place' }), /need confirmation/);
  assert.match(unfilledVisitMessage({ reason: 'no_eligible_places' }), /adjust this visit/);
  assert.match(unfilledVisitMessage({ reason: 'unknown' }), /No qualifying place/);
  assert.equal(unfilledVisitMessage({ reason: 'unknown', unfilledReason: 'Server supplied explanation' }), 'Server supplied explanation');
});
test('single Plan flow only has main navigation and contextual result sheets', async () => {
  // Source wiring, not device interaction or accessibility acceptance.
  const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /setTab\(|styles\.tabs|tab === "chat"/);
  assert.match(app, /message\.resultCard && plan && renderPlanCard\(\)/);
  assert.match(app, /sheet === "outing" && plan && selected === null/);
  assert.match(app, /sheet === "ready" && plan && !preview && selected === null/);
  assert.match(app, /const history = conversationHistory\(messages\)/);
  const branch = app.slice(app.indexOf('result.status === "show_ui"'));
  assert.ok(branch.indexOf('prepareReviewResponse(result, previous)') < branch.indexOf('updateDraft(review ? review.draft'));
  assert.match(app, /people: brief\.people\.map\(value => value\.id !== personId/);
  assert.match(app, /if \(saveLock\.current \|\| !current\.current\.plan \|\| readOnly\) return/);
  assert.match(app, /await library\.addPlan\(completedOutingCopy\(shownDraft\)\)/);
  assert.match(app, /live\.sessionEpoch !== accountState\.sessionEpoch/);
  assert.match(app, /current\.current !== shownDraft/);
  assert.match(app, /onEditTiming=\{!busy \? \(\) => openReview\(\{ panel: "timing" \}\)/);
});
test('disabled account state has honest scope and useful navigation without a dead sign-in CTA', async () => {
  const source = await readFile(new URL('../src/components/AccountScreen.tsx', import.meta.url), 'utf8');
  assert.match(source, /checkingAvailability && <ActivityIndicator/);
  assert.match(source, /Account availability unconfirmed/);
  assert.match(source, /Native sign-in is not available yet/);
  assert.match(source, /enabled === true \? <Button label="Continue in browser"/);
  assert.match(source, /Cloud plans, account circles and invitations cannot sync in this preview/);
  for (const section of ['plan', 'saved', 'circles']) assert.ok(source.includes(`onNavigate("${section}")`));
});

test('unrelated timing and budget edits preserve exact untouched artist arrays', () => {
  const people = [{ id: 'you', name: 'You', artists: ['Tyler, The Creator', ' Sade ', 'Sade'], vibes: [] }, { id: 'sam', name: 'Sam', artists: ['Artist, part two'], vibes: [] }];
  assert.deepEqual(applyArtistInputs(people, {}), people);
  assert.equal(applyArtistInputs(people, { sam: 'Tems' })[0], people[0]);
  assert.deepEqual(applyArtistInputs(people, { sam: 'Tems' })[0].artists, people[0].artists);
});
test('direct result saves use completed brief even after edits or failed refresh', () => {
  const completed = { ...newBrief(), area: 'Completed area', activities: ['coffee'] };
  const draft = { brief: { ...completed, area: 'New unsatisfied area' }, confirmed: false, plan: { request: completed, timeZone: 'Africa/Accra', stops: [] }, planningTimeZone: 'Europe/London' };
  const copy = completedOutingCopy(draft);
  assert.deepEqual(copy.brief, completed);
  assert.equal(copy.planningTimeZone, 'Africa/Accra');
  assert.equal(copy.confirmed, true);
  assert.equal(draft.brief.area, 'New unsatisfied area');
  assert.throws(() => completedOutingCopy({ plan: null }), /Find places/);
});

test('invalid targeted response leaves draft and current request active so the error can be shown', () => {
  const original = { brief: newBrief(), confirmed: false, plan: null };
  let draft = original, active = true, opened = false, visibleError = '';
  const result = { panel: 'tastes', personId: 'missing', request: { ...original.brief, budget: 500 } };
  try {
    const prepared = prepareReviewResponse(result, draft);
    draft = prepared.draft; active = false; opened = true;
  } catch (error) { if (active) visibleError = error.message; }
  assert.equal(draft, original);
  assert.equal(active, true);
  assert.equal(opened, false);
  assert.match(visibleError, /no longer in this outing/);
  const valid = prepareReviewResponse({ ...result, personId: 'you' }, original);
  assert.equal(valid.context.personId, 'you');
  assert.equal(valid.draft.brief.budget, 500);
});

test('saving an older outing never borrows the new area timezone when the old one was absent', () => {
  const before = { ...newBrief(), area: 'Old area', locationId: 'old' };
  const draft = { brief: { ...before, area: 'New area', locationId: 'new' }, plan: { request: before }, planningTimeZone: 'Europe/London' };
  assert.equal(completedOutingCopy(draft).planningTimeZone, undefined);
  assert.equal(completedOutingCopy({ ...draft, brief: before }).planningTimeZone, 'Europe/London');
});
