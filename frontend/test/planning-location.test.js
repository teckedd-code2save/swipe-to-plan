import test from 'node:test';
import assert from 'node:assert/strict';
import { withPreferredLocation } from '../src/planning-location.js';
import { nextPlanningStep } from '../src/plan-transition.js';

const london = { id: 'london', label: 'London, United Kingdom', currency: 'GBP' };
const fresh = () => ({ area: '', currency: 'GHS', currencyMode: 'local', budget: null, people: [{ artists: ['SZA'], vibes: ['v-nature'] }], activities: [] });

test('a fresh outing gets the saved area and its currency without changing tastes or budget', () => {
  const brief = fresh(), next = withPreferredLocation(brief, london);
  assert.equal(next.area, london.label);
  assert.equal(next.locationId, london.id);
  assert.equal(next.currency, 'GBP');
  assert.equal(next.budget, null);
  assert.equal(next.people, brief.people);
  assert.equal(brief.area, '');
  assert.equal(nextPlanningStep({ ...next, activities: ['coffee'] }, next !== brief), 'research');
});

test('explicit areas and custom currencies are preserved', () => {
  for (const current of [{ ...fresh(), area: 'Paris, France' }, { ...fresh(), locationId: 'paris' }]) {
    assert.equal(withPreferredLocation(current, london), current);
  }
  assert.equal(withPreferredLocation({ ...fresh(), currencyMode: 'custom', currency: 'USD' }, london).currency, 'USD');
});

test('missing, forgotten or incomplete defaults leave the location unset', () => {
  const brief = fresh();
  for (const preferred of [null, undefined, {}, { id: 'london' }, { label: london.label }, { id: 'london', label: london.label }]) {
    assert.equal(withPreferredLocation(brief, preferred), brief);
  }
});
