import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedPlaceGap,selectionGapSummary} from '../../shared/selection-evidence.js';
import {resultRouteSummary} from '../src/result-receipt.js';
import {partialPlanSummary,nextPlanSteps} from '../src/plan-assistance.js';
const plan=stop=>({phase:'discovery',request:{},stops:[{item:{name:'First café'}},stop]});

test('selected missing evidence is not narrated as verified ineligibility or total area coverage failure',()=>{
  const result=plan({item:null,intent:'coffee',reason:'selected_evidence_unavailable',selectionEvidence:{placeId:'qloo:b',status:'unavailable'}});
  for(const text of [resultRouteSummary(result),partialPlanSummary(result),nextPlanSteps(result).note]){assert.match(text,/compatible recent provider evidence is unavailable/);assert.doesNotMatch(text,/no caf[eé]|couldn.t find coffee in this area|does not meet/);}
  assert.match(nextPlanSteps(result).note,/no other place was substituted/);assert.deepEqual(nextPlanSteps(result).actions.map(a=>a.id),['review','retry']);
});
test('rejected selection explains only its actual current hard failure',()=>{
  for(const [reason,expected] of [['excluded_by_user',/excluded from this request/],['over_price_limit',/price-tier limit/],['price_unknown',/no reported price tier/],['intent_not_supported',/category evidence/],['location_not_supported',/requested area/],['permanently_closed',/permanently closed/],['excluded_tag',/venue restrictions/]]){
    const result=plan({item:null,reason:'selected_place_rejected',selectionEvidence:{reason}});for(const text of [resultRouteSummary(result),partialPlanSummary(result),nextPlanSteps(result).note])assert.match(text,expected);
  }
});
test('filled recovered visits and unrelated missing slots never invent a selected-evidence problem',()=>{
  assert.equal(selectedPlaceGap({item:{id:'a'},reason:'selected_evidence_unavailable'}),'');assert.equal(selectionGapSummary([{item:null,reason:'no_eligible_places'}]),'');
  const result=plan({item:{name:'Second café',provenance:{selectionEvidence:{source:'compatible_cache'}}}});assert.equal(partialPlanSummary(result),null);assert.doesNotMatch(resultRouteSummary(result),/unavailable|unfilled|rejected/);
});
test('nearby suggestions cannot mask the unresolved explicit selected visit',()=>{
  const result={...plan({item:null,reason:'selected_evidence_unavailable'}),nearbySuggestions:[{item:{name:'Other venue'}}]};result.stops[0].item=null;
  assert.match(partialPlanSummary(result),/compatible recent provider evidence is unavailable/);assert.match(nextPlanSteps(result).note,/requested visit remains unfilled/);assert.ok(nextPlanSteps(result).actions.some(action=>action.id==='shortlist'));
});
