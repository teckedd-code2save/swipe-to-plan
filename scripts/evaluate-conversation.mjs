// Opt-in live-model checks. Synthetic prompts only; no account data or logs.
// Run from the repository root: node scripts/evaluate-conversation.mjs
import assert from 'node:assert/strict';
import dotenv from '../backend/node_modules/dotenv/lib/main.js';
import {createAgent} from '../backend/src/agent.js';
import {parseItinerary} from '../backend/src/itinerary.js';
dotenv.config({path:'backend/.env',quiet:true});
const agent=createAgent();
const empty=parseItinerary({area:'',party:{adults:1,children:0},people:[{id:'you',name:'You',artists:[],vibes:[]}],timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'}},{allowMissingLocation:true});
const located={...empty,area:'Accra, Ghana',date:'2099-01-01',timing:{dateConfirmed:true,timeConfirmed:true,mode:'flexible'},startTime:'12:00',endTime:'17:00'};
const locationContext={confirmed:false,timeZone:'Africa/Accra'};
let passed=0,failed=0;
async function check(label,input,verify){
  try{
    const result=await agent.interpret({context:empty,locationContext,...input});verify(result);passed++;
    console.log(JSON.stringify({label,status:'pass',action:result.action||result.status,text:result.text||result.question||result.assistantMessage}));
    return result;
  }catch(error){failed++;console.error(JSON.stringify({label,status:'fail',reason:error.message}));return null;}
}
const conversational=r=>assert.ok(['reply','needs_input'].includes(r.status),'Expected a conversation before a planning action');
const research=await check('Research concern stays in the outing-companion role',{message:"I'm having issues with my research."},r=>{conversational(r);assert.match(r.text||r.question,/research|frustrat|stuck/i);});
const history=[{role:'user',text:"I'm having issues with my research."},{role:'assistant',text:research?.text||research?.question||'Would a change of scene or a short break help?'}];
const supervisor=await check('Mentioning a supervisor does not create a participant',{message:'I want to meet my supervisor',history},r=>{conversational(r);assert.match(r.text||r.question,/meet|supervisor/i);});
history.push({role:'user',text:'I want to meet my supervisor'},{role:'assistant',text:supervisor?.text||supervisor?.question||'Do you need somewhere to meet, or a break afterwards?'});
await check('An agreed meeting-place request becomes a concrete one-stop plan',{message:'Find somewhere for the two of us to meet in Accra. Just one cafe, tomorrow afternoon, 200 cedis.',history},r=>{
  assert.equal(r.action,'set_location');assert.deepEqual(r.request.activities,['coffee']);assert.equal(r.request.budget,200);assert.equal(r.request.currency,'GHS');
  assert.equal(r.request.timing.dateConfirmed,true);assert.equal(r.request.timing.timeConfirmed,true);assert.equal(r.request.timing.mode,'flexible');
  assert.equal(r.request.startTime,'12:00');assert.equal(r.request.endTime,'17:00');assert.equal(r.request.people.length,1);assert.equal(r.request.party.adults,2);assert.ok(r.assistantMessage);
});
await check('Autopilot still listens before acting on an unclear concern',{mode:'autopilot',message:'My boss has been making this week difficult.'},conversational);
await check('Budget worry does not silently set a budget or taste',{message:"I'm worried seeing my friends will end up costing too much."},conversational);
await check('A clear low-effort outing request acts without a new questionnaire',{context:located,locationContext:{...locationContext,confirmed:true},message:"I'm exhausted. Keep our chosen day and time, just one coffee stop in this area and a 120 cedi allowance."},r=>{
  assert.equal(r.status,'ready');assert.deepEqual(r.request.activities,['coffee']);assert.equal(r.request.budget,120);assert.ok(r.assistantMessage);
});
await check('Frustration with the agent leads to the requested repair',{context:located,locationContext:{...locationContext,confirmed:true},message:'You keep adding stops. I said just one place. Keep everything else as it is.'},r=>{
  assert.equal(r.status,'ready');assert.equal(r.request.activities.length,1);assert.equal(r.request.budget,located.budget);assert.deepEqual(r.request.people,located.people);
});
const group={...located,party:{adults:2,children:0},people:[{id:'you',name:'Alex',artists:['Sade'],vibes:[]},{id:'sam',name:'Sam',artists:['Tems'],vibes:[]}]};
await check('An explicit personal taste edit still preserves the rest of the profile',{context:group,message:'Sam wants seafood. Add it to his tastes and keep his music.'},r=>{
  assert.equal(r.action,'update_person');assert.equal(r.person.id,'sam');assert.deepEqual(r.person.artists,['Tems']);assert.ok(r.person.vibes.includes('v-seafood'));
});
await check('An explicit circle request still adds the saved circle',{context:located,message:'Bring my Sunday people into this outing.',circles:[{id:'sunday',name:'Sunday people',people:[group.people[1]]}]},r=>{assert.equal(r.action,'bring_circle');assert.equal(r.circleId,'sunday');});
console.log(`${passed} passed; ${failed} failed. Review the actual wording above as well as the structural checks.`);
process.exitCode=failed?1:0;
