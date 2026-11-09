import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountWorkspace} from '../src/account-planning.js';
const id='a40fc8a1-6a3e-4f07-bc69-ae52cc19387f';
test('private account drafts never replace the retained guest draft on logout or account switch',()=>{
 const workspace=createAccountWorkspace(),guest={brief:{title:'Guest'},plan:null};
 assert.equal(workspace.isPrivate(),false);
 assert.equal(workspace.switchIdentity('A',guest),null);
 guest.brief.title='Mutated';
 assert.equal(workspace.isPrivate(),true);
 assert.deepEqual(workspace.switchIdentity('B',{brief:{title:'Account A'}}),{brief:{title:'Guest'},plan:null});
 assert.deepEqual(workspace.switchIdentity(null,{brief:{title:'Account B'}}),{brief:{title:'Guest'},plan:null});
 assert.equal(workspace.isPrivate(),false);
});
test('only owned valid server plan metadata controls the next revision; local or shared copies start new',()=>{
 const workspace=createAccountWorkspace();workspace.switchIdentity('A',{});
 workspace.remember({savedPlan:{id,revision:4}});
 assert.deepEqual(workspace.headers(),{'x-unstressed-plan-id':id,'x-unstressed-plan-revision':'5'});
 workspace.remember({savedPlan:{id,revision:4}},false);assert.deepEqual(workspace.headers(),{});
 workspace.remember({savedPlan:{id:'forged',revision:-1}});assert.deepEqual(workspace.headers(),{});
 workspace.remember({savedPlan:{id,revision:8}});workspace.clearTarget();assert.deepEqual(workspace.headers(),{});
 workspace.remember({savedPlan:{id,revision:8}});workspace.switchIdentity(null,{});assert.deepEqual(workspace.headers(),{});
});
