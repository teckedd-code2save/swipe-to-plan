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

export function createAccounts({store=createAccountStore(),now=Date.now,origin=process.env.APP_ORIGIN||'http://127.0.0.1:5173',clientId=process.env.GOOGLE_OAUTH_CLIENT_ID,clientSecret=process.env.GOOGLE_OAUTH_CLIENT_SECRET,oauthFactory}={}){
  origin=new URL(origin).origin;
  const secure=origin.startsWith('https://');
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
  function returnPath(raw){if(raw==='/'||raw===undefined)return '/';if(typeof raw==='string'&&/^\/#\/(?:day|circle)\/[a-zA-Z0-9_-]{1,64}\?(?:key|invite)=[a-zA-Z0-9_-]{20,64}$/.test(raw))return raw;throw new InputError('Return to the planner after signing in.');}
  return {
    enabled,origin,redirectUri,
    async current(session){return store.read(data=>{const user=resolve(data,session);return {configured:enabled,user:user?safeUser(user):null,circles:user?myCircles(data,user):[]};});},
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
        // Stable Google subject is the identity. Never merge accounts by email.
        delete data.sessions[hash(previousSession)];
        data.sessions[hash(session)]={userId:user.id,expiresAt:now()+30*86400000};
      });
      return {session,returnTo:flow.returnTo};
    },
    async logout(session){await store.transact(data=>{delete data.sessions[hash(session)];});},
    async updateProfile(session,body){fields(body,['name','artists','vibes','spending']);return store.transact(data=>{const user=requireUser(data,session);user.profile=profile(body,user.id);return safeUser(user);});},
    async updatePlanningLocation(session,body,resolveLocation){
      fields(body,['locationId']);await store.read(data=>requireUser(data,session));
      if(body.locationId!==null&&!resolveLocation)throw new InputError('Location search is unavailable.');
      const selected=body.locationId===null?null:await resolveLocation(body.locationId);
      return store.transact(data=>{const user=requireUser(data,session);user.planningLocation=selected;return safeUser(user);});
    },
    async createCircle(session,body){
      fields(body,['name','people']);if(typeof body.name!=='string'||!body.name.trim()||body.name.length>40)throw new InputError('Name your circle in up to 40 characters.');
      const people=parseItinerary({party:{adults:body.people?.length||1},people:body.people}).people;
      return store.transact(data=>{const user=requireUser(data,session);if(myCircles(data,user).length>=12)throw new InputError('You can keep up to twelve circles.');
        const members=[{userId:user.id},...people.filter(p=>p.id!==user.id).map(p=>({profile:{...p,id:data.users[p.id]?randomUUID():p.id||randomUUID()}}))];if(members.length>6)throw new InputError('A circle has room for six people, including you.');
        const circle={id:randomUUID(),name:body.name.trim(),ownerId:user.id,members,inviteToken:opaque()};data.circles[circle.id]=circle;return circleView(data,circle,user);
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
    async updateCirclePerson(session,id,memberId,body){fields(body,['name','artists','vibes','spending']);return store.transact(data=>{const user=requireUser(data,session),circle=data.circles[id];if(!circle||circle.ownerId!==user.id)throw fail('Only this circle’s organizer can edit an invited profile.');const member=circle.members.find(m=>!m.userId&&m.profile.id===memberId);if(!member)throw fail('Members who have joined manage their own account tastes.');member.profile=profile(body,memberId);return circleView(data,circle,user);});},
    mount(app,{route,limit,resolveLocation}){
      const session=req=>cookie(req,sessionName);
      const mutation=(fn)=>route(async(req,res)=>{checkOrigin(req);await fn(req,res);});
      app.get('/api/account',route(async(req,res)=>res.json(await this.current(session(req)))));
      app.post('/api/auth/google/start',limit(10),mutation(async(req,res)=>{const result=await this.start(req.body);res.cookie(bindingName,result.binding,{...settings,maxAge:600000});res.json({url:result.url});}));
      app.get('/api/auth/google/callback',limit(20),route(async(req,res)=>{
        res.set({'Referrer-Policy':'no-referrer','Cache-Control':'no-store'});
        try{const result=await this.complete(req.query,cookie(req,bindingName),session(req));res.clearCookie(bindingName,settings);if(result.session)res.cookie(sessionName,result.session,{...settings,maxAge:30*86400000});const destination=new URL(result.returnTo,origin);destination.searchParams.set('signin',result.cancelled?'cancelled':'success');res.redirect(303,destination.href);}catch{res.clearCookie(bindingName,settings);res.redirect(303,`${origin}/?signin=failed`);}
      }));
      app.post('/api/auth/logout',mutation(async(req,res)=>{await this.logout(session(req));res.clearCookie(sessionName,settings);res.json({ok:true});}));
      app.patch('/api/account/profile',limit(45),mutation(async(req,res)=>res.json({user:await this.updateProfile(session(req),req.body)})));
      app.patch('/api/account/planning-location',limit(20),mutation(async(req,res)=>res.json({user:await this.updatePlanningLocation(session(req),req.body,resolveLocation)})));
      app.post('/api/account/circles',limit(15),mutation(async(req,res)=>res.status(201).json(await this.createCircle(session(req),req.body))));
      app.get('/api/circle-invites/:id',limit(30),route(async(req,res)=>res.json(await this.invite(req.params.id,req.get('x-circle-invite')))));
      app.post('/api/account/circles/:id/join',limit(15),mutation(async(req,res)=>res.json(await this.joinCircle(session(req),req.params.id,req.body))));
      app.patch('/api/account/circles/:id/members/:memberId',limit(45),mutation(async(req,res)=>res.json(await this.updateCirclePerson(session(req),req.params.id,req.params.memberId,req.body))));
      app.delete('/api/account/circles/:id',limit(15),mutation(async(req,res)=>{await this.removeCircle(session(req),req.params.id);res.json({ok:true});}));
    },
  };
}
