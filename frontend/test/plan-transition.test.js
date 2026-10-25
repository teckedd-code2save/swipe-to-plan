import test from 'node:test';
import assert from 'node:assert/strict';
import {nextPlanningStep} from '../src/plan-transition.js';

const brief={area:'Galilea',activities:['dinner'],timing:{dateConfirmed:true,timeConfirmed:true,mode:'flexible'}};

test('complete chat-driven draft advances to research without a second review',()=>{
  assert.equal(nextPlanningStep(brief,true),'research');
  assert.equal(nextPlanningStep({...brief,activities:['dinner','drinks']},true),'research');
});

test('missing prerequisites only ask for the missing planning input',()=>{
  assert.equal(nextPlanningStep(brief,false),'location');
  assert.equal(nextPlanningStep({...brief,timing:{...brief.timing,timeConfirmed:false}},true),'research');
  assert.equal(nextPlanningStep({...brief,activities:[]},true),'activities');
  assert.equal(nextPlanningStep({...brief,activities:[],timing:{...brief.timing,timeConfirmed:false}},true),'activities');
});

test('planning transition is based on state, never arbitrary chat keywords',()=>{
  for(const message of ['Results','Something fun tonight','Plan a meal','Please continue']){
    assert.equal(nextPlanningStep({...brief,message},true),'research');
  }
});

