import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRouteBudget,initializeRouteBudget} from '../src/route-budget.js';
import {createRouteActions} from '../src/route-actions.js';
const NOW=Date.parse('2026-11-08T12:00:00Z'),now=()=>NOW;
async function fixture(t){const dir=await fs.mkdtemp(join(tmpdir(),'route-budget-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=join(dir,'budget.json');await initializeRouteBudget({file,now});return {dir,file};}
const input=()=>({mode:'WALK',origin:{coordinates:{lat:0,lng:0}},stops:[{coordinates:{lat:0.01,lng:0.01}}]});
const options=(budget,fetchImpl)=>({provider:'mapbox',enabled:true,mapboxToken:'synthetic-token',budget,fetchImpl,now});
const count=async file=>JSON.parse(await fs.readFile(file,'utf8')).routeBudget.requests;
const unavailable=action=>assert.rejects(action,{code:'routes_budget_unavailable'});

test('explicit positive limit and durable absolute file are required; uninitialized ledger fails closed',async t=>{
  const {file,dir}=await fixture(t);
  for(const dailyLimit of [undefined,null,0,-1,1.1,'','0','-1','1.1',' 3 ','1e3',Infinity]){const budget=createRouteBudget({file,dailyLimit,now});assert.equal(budget.configured,false);await unavailable(budget.claim());}
  for(const path of [undefined,'relative.json'])assert.equal(createRouteBudget({file:path,dailyLimit:3}).configured,false);
  let calls=0;const api=createRouteActions(options(undefined,async()=>{calls++;}));assert.equal(api.capabilities().routeEstimates,false);await assert.rejects(api.estimate(input()),{code:'provider_not_configured'});assert.equal(calls,0);
  await unavailable(createRouteBudget({file:join(dir,'missing.json'),dailyLimit:3,now}).claim());
  await assert.rejects(fs.stat(join(dir,'missing.json')),{code:'ENOENT'});
});
test('concurrent claims serialize at the app-wide limit and restart preserves counted slots',async t=>{
  const {file}=await fixture(t);const budget=createRouteBudget({file,dailyLimit:'3',now});
  const results=await Promise.allSettled(Array.from({length:12},()=>budget.claim()));assert.equal(results.filter(r=>r.status==='fulfilled').length,3);
  assert.ok(results.filter(r=>r.status==='rejected').every(r=>r.reason.code==='routes_budget_exceeded'));assert.equal(await count(file),3);
  await assert.rejects(createRouteBudget({file,dailyLimit:3,now}).claim(),{code:'routes_budget_exceeded'});
  const raw=JSON.parse(await fs.readFile(file,'utf8'));assert.deepEqual(raw,{users:{},sessions:{},flows:{},circles:{},routeBudget:{version:1,period:'2026-11-08',requests:3}});
  assert.equal((await fs.stat(file)).mode&0o777,0o600);
});
test('UTC rollover allows a fresh period; backward clock fails closed',async t=>{
  const {file}=await fixture(t);let time=Date.parse('2026-11-08T23:59:59.999Z');const budget=createRouteBudget({file,dailyLimit:1,now:()=>time});
  await budget.claim();await assert.rejects(budget.claim(),{code:'routes_budget_exceeded'});time++;
  await budget.claim();assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')).routeBudget,{version:1,period:'2026-11-09',requests:1});
  await unavailable(createRouteBudget({file,dailyLimit:10,now}).claim());assert.equal(await count(file),1);
});
test('malformed state, unexpected personal records and impossible periods never reset or write',async t=>{
  const {file}=await fixture(t),valid=JSON.parse(await fs.readFile(file,'utf8'));
  for(const data of ['bad JSON','null','{}',JSON.stringify({...valid,users:{someone:{id:'x'}}}),...[
    {version:2,period:'2026-11-08',requests:0},{version:1,period:'2026-02-30',requests:0},{version:1,period:'2026-11-08',requests:-1},{version:1,period:'2026-11-08',requests:1.5},{version:1,period:'2026-11-08',requests:0,coordinates:[0,0]},
  ].map(routeBudget=>JSON.stringify({...valid,routeBudget}))]){
    await fs.writeFile(file,data);await unavailable(createRouteBudget({file,dailyLimit:5,now}).claim());assert.equal(await fs.readFile(file,'utf8'),data);
  }
});
function faultIO(file,stage,after=false){let armed=true,dirSync=0;const fail=async(name,fn)=>{if(armed&&name===stage){armed=false;if(after)await fn();throw Error('synthetic private failure detail');}return fn();};return {...fs,rename:(...args)=>fail('rename',()=>fs.rename(...args)),open:async(path,...args)=>{const handle=await fs.open(path,...args),kind=path===`${file}.intent`?'intent':path.endsWith('.tmp')?'temp':'directory';return {writeFile:(...a)=>fail(`${kind}-write`,()=>handle.writeFile(...a)),close:()=>handle.close(),sync:()=>fail(kind==='directory'?`directory-sync-${++dirSync}`:`${kind}-sync`,()=>handle.sync())};}};}
for(const [stage,after,persisted] of [['temp-write',false,0],['intent-sync',false,0],['rename',false,0],['rename',true,1],['directory-sync-2',false,1]])test(`${stage} persistence uncertainty never starts provider work or replays (${after})`,async t=>{
  const {file}=await fixture(t),budget=createRouteBudget({file,dailyLimit:3,now,io:faultIO(file,stage,after)});let calls=0;const api=createRouteActions(options(budget,async()=>{calls++;throw Error('do not call');}));
  for(let i=0;i<2;i++)await assert.rejects(api.estimate(input()),error=>{assert.equal(error.code,'routes_budget_unavailable');assert.doesNotMatch(error.message,/private|budget.json/);return true;});assert.equal(calls,0);assert.equal(await count(file),persisted);
  if(stage!=='temp-write')await unavailable(createRouteBudget({file,dailyLimit:3,now}).claim());
});
test('claim commits before provider I/O; unknown/error outcomes consume slots without retry or refund',async t=>{
  const {file}=await fixture(t),budget=createRouteBudget({file,dailyLimit:2,now});let calls=0;
  const api=createRouteActions(options(budget,async()=>{calls++;assert.equal(await count(file),calls);throw Error('unknown provider outcome');}));
  await assert.rejects(api.estimate(input()),{code:'routes_unreachable'});await assert.rejects(api.estimate(input()),{code:'routes_unreachable'});await assert.rejects(api.estimate(input()),{code:'routes_budget_exceeded'});assert.equal(calls,2);assert.equal(await count(file),2);
});
test('unsupported or invalid route inputs never consume a slot; no coordinates or tokens are stored',async t=>{
  const {file}=await fixture(t);const api=createRouteActions(options(createRouteBudget({file,dailyLimit:2,now}),async()=>{throw Error('never');}));
  await assert.rejects(api.estimate({...input(),mode:'TRANSIT'}),{code:'routes_unsupported_mode'});await assert.rejects(api.estimate({...input(),origin:{address:'Synthetic address'}}),{code:'routes_coordinates_required'});await assert.rejects(api.estimate({}),{code:'invalid_request'});assert.equal(await count(file),0);assert.doesNotMatch(await fs.readFile(file,'utf8'),/token|coordinates|address|origin/);
});
test('initialization refuses an existing ledger or outstanding intent without modifying it',async t=>{
  const {file,dir}=await fixture(t),before=await fs.readFile(file,'utf8');await unavailable(initializeRouteBudget({file,now}));assert.equal(await fs.readFile(file,'utf8'),before);
  const missing=join(dir,'missing.json');await fs.writeFile(`${missing}.intent`,'ambiguous');await unavailable(initializeRouteBudget({file:missing,now}));assert.equal(await fs.readFile(`${missing}.intent`,'utf8'),'ambiguous');
});
test('crash after durable claim before provider work never refunds the slot on restart',async t=>{
  const {file}=await fixture(t);const module=new URL('../src/route-budget.js',import.meta.url).href;
  const script=`import {createRouteBudget} from ${JSON.stringify(module)};await createRouteBudget({file:${JSON.stringify(file)},dailyLimit:1,now:()=>${NOW}}).claim();process.exit(73);`;
  assert.equal(spawnSync(process.execPath,['--input-type=module','-e',script]).status,73);
  await assert.rejects(createRouteBudget({file,dailyLimit:1,now}).claim(),{code:'routes_budget_exceeded'});assert.equal(await count(file),1);
});

test('concurrent initializers publish exactly one fresh ledger without replacing it',async t=>{
  const {dir}=await fixture(t),file=join(dir,'concurrent.json');
  const results=await Promise.allSettled(Array.from({length:12},()=>initializeRouteBudget({file,now})));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.ok(results.filter(result=>result.status==='rejected').every(result=>result.reason.code==='routes_budget_unavailable'));
  await createRouteBudget({file,dailyLimit:2,now}).claim();assert.equal(await count(file),1);
  assert.deepEqual((await fs.readdir(dir)).sort(),['budget.json','concurrent.json']);
});
test('a claimed ledger appearing after initializer preflight is never reset',async t=>{
  const {dir}=await fixture(t),file=join(dir,'race.json');let reached,release;
  const started=new Promise(resolve=>reached=resolve),gate=new Promise(resolve=>release=resolve);
  const io={...fs,lstat:async(path,...args)=>{
    try{return await fs.lstat(path,...args);}catch(error){
      if(path===`${file}.intent`&&error.code==='ENOENT'){reached();await gate;}
      throw error;
    }
  }};
  const first=initializeRouteBudget({file,now,io});const rejected=unavailable(first);await started;
  await initializeRouteBudget({file,now});await createRouteBudget({file,dailyLimit:3,now}).claim();
  const before=await fs.readFile(file,'utf8');release();await rejected;
  assert.equal(await fs.readFile(file,'utf8'),before);assert.equal(await count(file),1);
  // The losing initializer must clean only its own setup files, leaving a usable count.
  await createRouteBudget({file,dailyLimit:3,now}).claim();assert.equal(await count(file),2);
  assert.deepEqual((await fs.readdir(dir)).sort(),['budget.json','race.json']);
});
test('a pending journal appearing during setup is not replaced or deleted',async t=>{
  const {dir}=await fixture(t),file=join(dir,'pending.json'),other=`${file}.other-operation.tmp`;let reached,release;
  const started=new Promise(resolve=>reached=resolve),gate=new Promise(resolve=>release=resolve);
  const io={...fs,open:async(path,...args)=>{if(path.startsWith(`${file}.`)&&path.endsWith('.tmp')){reached();await gate;}return fs.open(path,...args);}};
  const first=initializeRouteBudget({file,now,io});const rejected=unavailable(first);await started;
  await fs.writeFile(`${file}.intent`,'another operation pending');await fs.writeFile(other,'preserve this recovery evidence');release();await rejected;
  assert.equal(await fs.readFile(`${file}.intent`,'utf8'),'another operation pending');assert.equal(await fs.readFile(other,'utf8'),'preserve this recovery evidence');
  await assert.rejects(fs.stat(file),{code:'ENOENT'});assert.deepEqual((await fs.readdir(dir)).sort(),['budget.json','pending.json.intent','pending.json.other-operation.tmp']);
});
test('atomic publication cannot replace a ledger appearing immediately before link',async t=>{
  const {dir}=await fixture(t),file=join(dir,'link-collision.json');
  const existing={users:{},sessions:{},flows:{},circles:{},routeBudget:{version:1,period:'2026-11-08',requests:1}};
  const io={...fs,link:async(temp,target)=>{await fs.writeFile(target,JSON.stringify(existing),{flag:'wx'});return fs.link(temp,target);}};
  await unavailable(initializeRouteBudget({file,now,io}));assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),existing);
  // Unexpected publication-time races are conservatively blocked, not erased.
  assert.ok(await fs.stat(`${file}.intent`));await unavailable(createRouteBudget({file,dailyLimit:3,now}).claim());
});
test('uncertain initialization publication retains its journal and never resets on retry or restart',async t=>{
  const {dir}=await fixture(t),file=join(dir,'unknown-link.json');
  const io={...fs,link:async(...args)=>{await fs.link(...args);throw Error('synthetic link outcome unknown');}};
  await unavailable(initializeRouteBudget({file,now,io}));assert.equal(await count(file),0);
  const before=await fs.readFile(file,'utf8'),journal=await fs.readFile(`${file}.intent`,'utf8');
  await unavailable(initializeRouteBudget({file,now}));await unavailable(createRouteBudget({file,dailyLimit:3,now}).claim());
  assert.equal(await fs.readFile(file,'utf8'),before);assert.equal(await fs.readFile(`${file}.intent`,'utf8'),journal);
});
test('initialization never replaces damaged files or dangling target symlinks',async t=>{
  const {dir}=await fixture(t),file=join(dir,'damaged.json');await fs.writeFile(file,'damaged');
  await unavailable(initializeRouteBudget({file,now}));assert.equal(await fs.readFile(file,'utf8'),'damaged');
  const symlink=join(dir,'symlink.json'),target=join(dir,'not-created');await fs.symlink(target,symlink);
  await unavailable(initializeRouteBudget({file:symlink,now}));assert.equal(await fs.readlink(symlink),target);await assert.rejects(fs.stat(target),{code:'ENOENT'});
});

test('post-publication directory-sync failure keeps initialization recovery evidence and blocks claims',async t=>{
  const {dir}=await fixture(t),file=join(dir,'init-sync.json');let syncs=0;
  const io={...fs,open:async(path,...args)=>{const handle=await fs.open(path,...args);if(path!==dir)return handle;return {close:()=>handle.close(),sync:async()=>{if(++syncs===2)throw Error('synthetic directory sync failure');await handle.sync();}};}};
  await unavailable(initializeRouteBudget({file,now,io}));assert.equal(await count(file),0);
  const intent=JSON.parse(await fs.readFile(`${file}.intent`,'utf8'));assert.ok(await fs.stat(intent.temp));
  await unavailable(createRouteBudget({file,dailyLimit:3,now}).claim());
});
