import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {OAuth2Client,CodeChallengeMethod} from 'google-auth-library';
import {InputError} from './contract.js';
import {parseItinerary} from './itinerary.js';

const opaque=()=>randomBytes(32).toString('base64url');
const hash=value=>createHash('sha256').update(String(value||'')).digest('base64url');
const fail=(message,status=403)=>Object.assign(new Error(message),{status,code:'account_error'});
const fields=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw new InputError('Check the account request.');};
const profile=(value,id)=>({...parseItinerary({party:{adults:1},people:[value]}).people[0],id});
const safeUser=user=>({id:user.id,email:user.email,profile:user.profile,planningLocation:user.planningLocation||null});
const cookie=(req,name)=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(`${name}=`))?.slice(name.length+1);

// A durable, single-process store, matching the shared-day deployment model.
// Copy-on-write transactions serialize identities, invites and session rotation.
export function createAccountStore({file=null,now=Date.now}={}){
  let data,loading,queue=Promise.resolve();
  async function load(){if(data)return;if(!loading)loading=(async()=>{try{data=file?JSON.parse(await readFile(file,'utf8')):null;}catch(e){if(e.code!=='ENOENT')throw e;}data??={users:{},sessions:{},flows:{},circles:{}};})();await loading;}
  return {
    async read(fn){await queue;await load();return structuredClone(fn(data));},
    transact(fn){const task=queue.then(async()=>{await load();const next=structuredClone(data);for(const collection of ['flows','sessions'])for(const [id,value] of Object.entries(next[collection]))if(value.expiresAt<=now())delete next[collection][id];const result=await fn(next);if(file){await mkdir(dirname(file),{recursive:true,mode:0o700});const temp=`${file}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(next),{mode:0o600});await rename(temp,file);}data=next;return structuredClone(result);});queue=task.catch(()=>{});return task;},
  };
}

export function createAccounts({store=createAccountStore(),now=Date.now,origin=process.env.APP_ORIGIN||'http://127.0.0.1:5173',clientId=process.env.GOOGLE_OAUTH_CLIENT_ID,clientSecret=process.env.GOOGLE_OAUTH_CLIENT_SECRET,adminEmails=(process.env.ADMIN_EMAILS||'').split(',').map(e=>e.trim().toLowerCase()).filter(Boolean),oauthFactory}={}){
  origin=new URL(origin).origin;
  const secure=origin.startsWith('https://');
  const isAdmin=user=>!!user&&adminEmails.includes(user.email.toLowerCase());
  const enabled=!!(clientId&&clientSecret&&(secure||process.env.NODE_ENV!=='production'));
  const redirectUri=`${origin}/api/auth/google/callback`;
  const oauth=()=>oauthFactory?oauthFactory():new OAuth2Client({clientId,clientSecret,redirectUri,transporterOptions:{timeout:15000,retry:false}});
  function checkOrigin(req){if(req.get('origin')!==origin||!req.is('application/json'))throw fail('Please make this change from Unstressed.');}
  const settings={httpOnly:true,secure,sameSite:'lax',path:'/'};
  const sessionName=secure?'__Host-outing-session':'outing-session';
  const bindingName=secure?'__Host-outing-signin':'outing-signin';
  const resolve=(data,session)=>{const record=data.sessions[hash(session)];return record&&record.expiresAt>now()?data.users[record.userId]:null;};
  const requireUser=(data,session)=>{const user=resolve(data,session);if(!user)throw fail('Sign in to keep your tastes and circles.',401);return user;};
  const circleView=(data,circle,user)=>({id:circle.id,name:circle.name,owner:circle.ownerId===user.id,people:circle.members.map(m=>m.userId?data.users[m.userId].profile:m.profile),accountIds:circle.members.flatMap(m=>m.userId?[m.userId]:[]),...(circle.ownerId===user.id?{inviteToken:circle.inviteToken}:{})});
  const myCircles=(data,user)=>Object.values(data.circles).filter(c=>c.members.some(m=>m.userId===user.id)).map(c=>circleView(data,c,user));
  function returnPath(raw){if(raw==='/'||raw===undefined)return '/';if(typeof raw==='string'&&(/^\/#\/(?:day|circle)\/[a-zA-Z0-9_-]{1,64}\?(?:key|invite)=[a-zA-Z0-9_-]{20,64}$/.test(raw)||/^\/#\/plan\/[a-zA-Z0-9_-]{1,64}$/.test(raw)))return raw;throw new InputError('Return to the planner after signing in.');}
  const planSummary=entry=>({id:entry.id,revision:entry.revision,savedAt:entry.savedAt,title:entry.plan.request.title,date:entry.plan.request.date,area:entry.plan.request.area,budget:entry.plan.request.budget,currency:entry.plan.request.currency});
  const savedPlan=(user,id)=>{if(!Object.hasOwn(user.savedPlans||{},id))throw fail('This saved day is not in your account.',404);return user.savedPlans[id];};
  return {
    enabled,origin,redirectUri,
    // Only server-generated plans enter this store; clients cannot upload venue/evidence snapshots.
    async planTarget(req,{shared=false}={}){
      const user=await this.identity(req);if(!user)return null;
      checkOrigin(req);
      const id=req.get('x-unstressed-plan-id')||randomUUID(),revision=Number(req.get('x-unstressed-plan-revision')||1);
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||!Number.isSafeInteger(revision)||revision<1)throw new InputError('Please reopen the saved day before editing it.');
      const session=cookie(req,sessionName);
      // Reworking an archived shared-day snapshot starts a private copy. Live
      // participant updates must never overwrite that independent revision.
      if(!shared&&await store.read(data=>!!resolve(data,session)?.savedPlans?.[id]?.sourceDayId))return {session,id:randomUUID(),revision:1};
      return {session,id,revision};
    },
    async keepPlan(target,plan){
      if(!target)return plan;
      try{
        const saved=await store.transact(data=>{
          const user=requireUser(data,target.session),entries=user.savedPlans??={},previous=entries[target.id];
          if(previous&&target.revision===previous.revision&&JSON.stringify(plan)===JSON.stringify(previous.plan))return planSummary(previous);
          if(previous&&target.revision<=previous.revision)throw fail('A newer version is already saved. Reopen it from Saved days.',409);
          if(!previous&&Object.keys(entries).length>=100)throw fail('Your account holds 100 days. Remove an old saved day to make room.',409);
          const entry={id:target.id,revision:target.revision,savedAt:new Date(now()).toISOString(),plan:structuredClone(plan),previous:previous?{plan:previous.plan,revision:previous.revision}:null,...(target.sourceDayId?{sourceDayId:target.sourceDayId}:{})};
          delete entry.plan.savedPlan;delete entry.plan.saveError;
          entries[entry.id]=entry;user.savedPlans=entries;return planSummary(entry);
        });
        return {...plan,savedPlan:saved};
      }catch(e){return {...plan,saveError:e.status?e.message:'Your day is ready, but account saving failed. Keep a copy on this device before leaving.'};}
    },
    async listPlans(session){return store.read(data=>Object.values(requireUser(data,session).savedPlans||{}).sort((a,b)=>b.savedAt.localeCompare(a.savedAt)).map(planSummary));},
    async getPlan(session,id){return store.read(data=>{const entry=savedPlan(requireUser(data,session),id);return {...entry.plan,savedPlan:planSummary(entry)};});},
    async editSavedPlan(session,id,body){
      fields(body,['revision','pins','restoreRevision']);
      return store.transact(data=>{
        const user=requireUser(data,session);let entry=savedPlan(user,id);
        if(body.revision!==entry.revision)throw fail('This day changed elsewhere. Reopen it from Saved days before editing.',409);
        if(entry.sourceDayId){if(Object.keys(user.savedPlans).length>=100)throw fail('Remove an old saved day to make room for this private copy.',409);entry=structuredClone(entry);entry.id=randomUUID();delete entry.sourceDayId;user.savedPlans[entry.id]=entry;}
        if(body.restoreRevision!==undefined){
          if(!entry.previous||body.restoreRevision!==entry.previous.revision||body.pins!==undefined)throw fail('That earlier version is no longer available.',409);
          const current={plan:entry.plan,revision:entry.revision};entry.plan=entry.previous.plan;entry.previous=current;
        }else{
          const request=parseItinerary({...entry.plan.request,pins:body.pins});
          if(Object.entries(request.pins).some(([intent,id])=>!entry.plan.stops.some(s=>s.intent===intent&&s.item?.id===id)))throw new InputError('Only keep places already in this day.');
          entry.plan={...entry.plan,request};
        }
        entry.revision++;entry.savedAt=new Date(now()).toISOString();return {...entry.plan,savedPlan:planSummary(entry)};
      });
    },
    async removePlan(session,id){await store.transact(data=>{const user=requireUser(data,session);savedPlan(user,id);delete user.savedPlans[id];});},
    async current(session){return store.read(data=>{const user=resolve(data,session);return {configured:enabled,user:user?{...safeUser(user),admin:isAdmin(user)}:null,circles:user?myCircles(data,user):[]};});},
    async identity(req){return store.read(data=>{const user=resolve(data,cookie(req,sessionName));return user?{id:user.id,admin:isAdmin(user)}:null;});},
    async adminUsers(req){return store.read(data=>{const user=requireUser(data,cookie(req,sessionName));if(!isAdmin(user))throw fail('This dashboard is private.');return Object.values(data.users).map(u=>({id:u.id,name:u.profile.name,email:u.email,createdAt:u.createdAt,lastSignedInAt:u.lastSignedInAt||null,circles:Object.values(data.circles).filter(c=>c.members.some(m=>m.userId===u.id)).length,hasTastes:!!(u.profile.artists.length||u.profile.vibes.length)}));});},
    async planningPeople(req){
      const current=await this.current(cookie(req,sessionName));
      if(!current.user)return {peopleMode:'guest'};
      const circles=current.circles.map(c=>({id:c.id,name:c.name,people:c.people.filter(p=>c.accountIds.includes(p.id))}));
      const contacts=[...new Map([current.user.profile,...circles.flatMap(c=>c.people)].map(p=>[p.id,p])).values()].slice(0,72);
      const planningMemory=await store.read(data=>{const user=resolve(data,cookie(req,sessionName));return Object.values(user?.savedPlans||{}).sort((a,b)=>b.savedAt.localeCompare(a.savedAt)).slice(0,3).map(entry=>({area:entry.plan.request.area,activities:entry.plan.request.activities}));});
      return {peopleMode:'connected',circles,contacts,planningMemory};
    },
    async start(body){fields(body,['returnTo']);if(!enabled)throw fail('Google sign-in is being connected. Your day can continue as a guest.',503);const returnTo=returnPath(body.returnTo),state=opaque(),binding=opaque(),verifier=opaque(),nonce=opaque();await store.transact(data=>{data.flows[hash(state)]={binding:hash(binding),verifier,nonce,returnTo,expiresAt:now()+600000};});return {binding,url:oauth().generateAuthUrl({scope:['openid','email','profile'],state,nonce,prompt:'select_account',code_challenge:hash(verifier),code_challenge_method:CodeChallengeMethod.S256,access_type:'online'})};},
    async complete(query,binding,previousSession){
      if(!enabled||typeof query.state!=='string'||!/^[-\w]{43}$/.test(query.state)||typeof binding!=='string'||!/^[-\w]{43}$/.test(binding))throw fail('Sign-in expired. Please try again.',401);
      const flow=await store.transact(data=>{const key=hash(query.state),value=data.flows[key];if(!value||value.binding!==hash(binding))throw fail('Sign-in expired. Please try again.',401);delete data.flows[key];return value;});
      if(query.error)return {returnTo:flow.returnTo,cancelled:true};
      let identity;
      try{if(typeof query.code!=='string'||!query.code||query.code.length>4096)throw Error();const client=oauth(),{tokens}=await client.getToken({code:query.code,codeVerifier:flow.verifier});if(!tokens.id_token)throw Error();identity=(await client.verifyIdToken({idToken:tokens.id_token,audience:clientId})).getPayload();if(!identity?.sub||identity.email_verified!==true||identity.nonce!==flow.nonce)throw Error();}catch{throw fail('Google sign-in could not be verified. Please try again.',401);}
      const session=opaque();
      await store.transact(data=>{
        let user=Object.values(data.users).find(u=>u.googleSubject===identity.sub);
        if(!user){const id=randomUUID();user={id,googleSubject:identity.sub,email:identity.email||'',profile:{id,name:(identity.name?.trim()||'You').slice(0,24),artists:[],vibes:[]},createdAt:new Date(now()).toISOString()};data.users[id]=user;}
        user.email=identity.email||user.email;
        user.lastSignedInAt=new Date(now()).toISOString();
        // Stable Google subject is the identity. Never merge accounts by email.
        delete data.sessions[hash(previousSession)];
        data.sessions[hash(session)]={userId:user.id,expiresAt:now()+30*86400000};
      });
      return {session,returnTo:flow.returnTo};
    },
    async logout(session){await store.transact(data=>{delete data.sessions[hash(session)];});},
    async updateProfile(session,body){fields(body,['name','artists','vibes','spending','context']);return store.transact(data=>{const user=requireUser(data,session);user.profile=profile(body,user.id);return {...safeUser(user),admin:isAdmin(user)};});},
    async updatePlanningLocation(session,body,resolveLocation){
      fields(body,['locationId']);await store.read(data=>requireUser(data,session));
      if(body.locationId!==null&&!resolveLocation)throw new InputError('Location search is unavailable.');
      const selected=body.locationId===null?null:await resolveLocation(body.locationId);
      return store.transact(data=>{const user=requireUser(data,session);user.planningLocation=selected;return {...safeUser(user),admin:isAdmin(user)};});
    },
    async createCircle(session,body){
      fields(body,['name','people']);if(typeof body.name!=='string'||!body.name.trim()||body.name.length>40)throw new InputError('Name your circle in up to 40 characters.');
      const people=parseItinerary({party:{adults:body.people?.length||1},people:body.people}).people;
      return store.transact(data=>{const user=requireUser(data,session);if(myCircles(data,user).length>=12)throw new InputError('You can keep up to twelve circles.');
        const members=[{userId:user.id},...people.filter(p=>p.id!==user.id).map(p=>({profile:{...p,id:data.users[p.id]?randomUUID():p.id||randomUUID()}}))];if(members.length>6)throw new InputError('A circle has room for six people, including you.');
        const circle={id:randomUUID(),name:body.name.trim(),ownerId:user.id,members,inviteToken:opaque()};data.circles[circle.id]=circle;return circleView(data,circle,user);
      });
    },
    async inviteByEmail(session,id,body){
      fields(body,['email']);
      const email=String(body.email||'').trim().toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw new InputError('Enter a valid email address.');
      if(!process.env.RESEND_API_KEY||!process.env.CIRCLE_INVITE_FROM)throw fail('Email invitations are not configured yet.',503);
      const token=opaque();
      const record=await store.transact(data=>{
        const user=requireUser(data,session),circle=data.circles[id];
        if(!circle||!circle.members.some(member=>member.userId===user.id))throw fail('Only existing circle members can invite.');
        circle.emailInvites??={};
        const pending=Object.values(circle.emailInvites).filter(item=>item.expiresAt>now());
        if(pending.length>=10)throw fail('This circle has reached its pending invitation limit.',429);
        const key=hash(token);
        circle.emailInvites[key]={email,expiresAt:now()+7*86400000,createdAt:now()};
        return {name:circle.name};
      });
      const url=`${origin}/#/circle/${encodeURIComponent(id)}?invite=${token}`;
      try{
        const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.CIRCLE_INVITE_FROM,to:[email],subject:'Invitation to join a circle on Unstressed',text:`You've been invited to join ${record.name} on Unstressed. Sign in with this email and accept: ${url}\nThis invitation expires in seven days.`}),signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw Error('Email provider unavailable');
      }catch(e){await store.transact(data=>{delete data.circles[id]?.emailInvites?.[hash(token)];});throw fail('Could not deliver the invitation. Try again.',502);}
      return {sent:true};
    },
    async acceptEmailInvite(session,id,body){
      fields(body,['token']);
      return store.transact(data=>{
        const user=requireUser(data,session),circle=data.circles[id];
        const key=hash(body.token||''),pending=circle?.emailInvites?.[key];
        if(!pending||pending.expiresAt<=now())throw fail('This invitation has expired or is unavailable.',404);
        if(user.email.toLowerCase()!==pending.email)throw fail('Sign in with the email address that received the invitation.');
        if(!circle.members.some(m=>m.userId===user.id)){
          if(circle.members.length>=6)throw fail('This circle is full.',409);
          circle.members.push({userId:user.id});
        }
        delete circle.emailInvites[key];
        return circleView(data,circle,user);
      });
    },
    async invite(id,token){return store.read(data=>{const circle=data.circles[id];if(!circle||typeof token!=='string'||hash(circle.inviteToken)!==hash(token))throw fail('This circle invite is no longer available.',404);return {id:circle.id,name:circle.name,members:circle.members.map(m=>({id:m.userId||m.profile.id,name:m.userId?data.users[m.userId].profile.name:m.profile.name,claimable:!m.userId}))};});},
    async joinCircle(session,id,body){fields(body,['inviteToken','replaceId']);return store.transact(data=>{const user=requireUser(data,session),circle=data.circles[id];if(!circle||typeof body.inviteToken!=='string'||hash(circle.inviteToken)!==hash(body.inviteToken))throw fail('This circle invite is no longer available.',404);if(circle.members.some(m=>m.userId===user.id))return circleView(data,circle,user);if(myCircles(data,user).length>=12)throw new InputError('You can keep up to twelve circles.');
      const index=body.replaceId?circle.members.findIndex(m=>!m.userId&&m.profile.id===body.replaceId):-1;
      if(body.replaceId&&index<0)throw fail('That place in the circle is already taken. Please choose again.',409);
      if(index>=0)circle.members[index]={userId:user.id};else{if(circle.members.length>=6)throw new InputError('This circle is full. Choose your existing name or ask the organizer to make room.');circle.members.push({userId:user.id});}
      return circleView(data,circle,user);
    });},
    async removeCircle(session,id){await store.transact(data=>{const user=requireUser(data,session),circle=data.circles[id];if(!circle||!circle.members.some(m=>m.userId===user.id))throw fail('Circle not found.',404);if(circle.ownerId===user.id)delete data.circles[id];else circle.members=circle.members.filter(m=>m.userId!==user.id);});},
    async removeCircleMember(session,id,memberId){
      return store.transact(data=>{
        const user=requireUser(data,session),circle=data.circles[id];
        if(!circle||circle.ownerId!==user.id)throw fail('Only the circle organizer can remove members.');
        if(memberId===circle.ownerId)throw fail('The organizer cannot be removed from their circle.');
        const index=circle.members.findIndex(m=>m.userId===memberId||(!m.userId&&m.profile?.id===memberId));
        if(index<0)throw fail('Circle member not found.',404);
        circle.members.splice(index,1);
        return circleView(data,circle,user);
      });
    },
    async updateCirclePerson(session,id,memberId,body){fields(body,['name','artists','vibes','spending','context']);return store.transact(data=>{const user=requireUser(data,session),circle=data.circles[id];if(!circle||circle.ownerId!==user.id)throw fail('Only this circle’s organizer can edit an invited profile.');const member=circle.members.find(m=>!m.userId&&m.profile.id===memberId);if(!member)throw fail('Members who have joined manage their own account tastes.');member.profile=profile(body,memberId);return circleView(data,circle,user);});},
    mount(app,{route,limit,resolveLocation}){
      const session=req=>cookie(req,sessionName);
      const mutation=(fn)=>route(async(req,res)=>{checkOrigin(req);await fn(req,res);});
      app.get('/api/account',route(async(req,res)=>res.json(await this.current(session(req)))));
      app.get('/api/account/plans',route(async(req,res)=>res.json({plans:await this.listPlans(session(req))})));
      app.get('/api/account/plans/:id',route(async(req,res)=>res.json(await this.getPlan(session(req),req.params.id))));
      app.patch('/api/account/plans/:id',limit(45),mutation(async(req,res)=>res.json(await this.editSavedPlan(session(req),req.params.id,req.body))));
      app.delete('/api/account/plans/:id',limit(20),mutation(async(req,res)=>{await this.removePlan(session(req),req.params.id);res.json({ok:true});}));
      app.post('/api/auth/google/start',limit(10),mutation(async(req,res)=>{const result=await this.start(req.body);res.cookie(bindingName,result.binding,{...settings,maxAge:600000});res.json({url:result.url});}));
      app.get('/api/auth/google/callback',limit(20),route(async(req,res)=>{
        res.set({'Referrer-Policy':'no-referrer','Cache-Control':'no-store'});
        try{const result=await this.complete(req.query,cookie(req,bindingName),session(req));res.clearCookie(bindingName,settings);if(result.session)res.cookie(sessionName,result.session,{...settings,maxAge:30*86400000});const destination=new URL(result.returnTo,origin);destination.searchParams.set('signin',result.cancelled?'cancelled':'success');res.redirect(303,destination.href);}catch{res.clearCookie(bindingName,settings);res.redirect(303,`${origin}/?signin=failed`);}
      }));
      app.post('/api/auth/logout',mutation(async(req,res)=>{await this.logout(session(req));res.clearCookie(sessionName,settings);res.json({ok:true});}));
      app.patch('/api/account/profile',limit(45),mutation(async(req,res)=>res.json({user:await this.updateProfile(session(req),req.body)})));
      app.patch('/api/account/planning-location',limit(20),mutation(async(req,res)=>res.json({user:await this.updatePlanningLocation(session(req),req.body,resolveLocation)})));
      app.post('/api/account/circles',limit(15),mutation(async(req,res)=>res.status(201).json(await this.createCircle(session(req),req.body))));
      app.post('/api/account/circles/:id/email-invites',limit(5),mutation(async(req,res)=>res.status(202).json(await this.inviteByEmail(session(req),req.params.id,req.body))));
      app.post('/api/account/circles/:id/email-invites/accept',limit(15),mutation(async(req,res)=>res.json(await this.acceptEmailInvite(session(req),req.params.id,req.body))));
      app.get('/api/circle-invites/:id',limit(30),route(async(req,res)=>res.json(await this.invite(req.params.id,req.get('x-circle-invite')))));
      app.post('/api/account/circles/:id/join',limit(15),mutation(async(req,res)=>res.json(await this.joinCircle(session(req),req.params.id,req.body))));
      app.delete('/api/account/circles/:id/members/:memberId',limit(20),mutation(async(req,res)=>res.json(await this.removeCircleMember(session(req),req.params.id,req.params.memberId))));
      app.patch('/api/account/circles/:id/members/:memberId',limit(45),mutation(async(req,res)=>res.json(await this.updateCirclePerson(session(req),req.params.id,req.params.memberId,req.body))));
      app.delete('/api/account/circles/:id',limit(15),mutation(async(req,res)=>{await this.removeCircle(session(req),req.params.id);res.json({ok:true});}));
    },
  };
}

