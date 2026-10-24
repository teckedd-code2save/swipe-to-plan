import {usageSession} from './usage.js';
async function json(url, options = {}) {
  const response = await fetch(url, {signal:AbortSignal.timeout(25000),...options,headers:{"content-type":"application/json",...(!navigator.globalPrivacyControl?{"x-unstressed-session":usageSession()}:{}),...options.headers}});
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || `Request failed (${response.status}).`), {status:response.status,code:body.code});
  return body;
}
const post = (body) => ({ method: "POST", body: JSON.stringify(body) });
const dayRequest = (token, method='GET', body) => ({ method, headers: {'content-type':'application/json', authorization:`Bearer ${token}`}, ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:AbortSignal.timeout(45000) });
export const api = {
  locations:(q,signal)=>json(`/api/locations?q=${encodeURIComponent(q)}`,{signal}),
  nearbyLocations:(point,signal)=>json('/api/locations/nearby',{...post(point),signal}),
  location:id=>json(`/api/locations/${encodeURIComponent(id)}`),
  planningLocation:id=>json('/api/account/planning-location',{method:'PATCH',body:JSON.stringify({locationId:id})}),
  usage:days=>json(`/api/admin/usage?days=${days}`),
  account:()=>json('/api/account'),
  savedPlans:()=>json('/api/account/plans'),
  savedPlan:id=>json(`/api/account/plans/${encodeURIComponent(id)}`),
  editSavedPlan:(id,body)=>json(`/api/account/plans/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)}),
  deleteSavedPlan:id=>json(`/api/account/plans/${encodeURIComponent(id)}`,{method:'DELETE',body:'{}'}),
  saveSharedPlan:(id,token,headers)=>json(`/api/account/plans/from-day/${encodeURIComponent(id)}`,{...dayRequest(token,'POST',{}),headers:{...headers,authorization:`Bearer ${token}`}}),
  signIn:returnTo=>json('/api/auth/google/start',post({returnTo})),
  signOut:()=>json('/api/auth/logout',post({})),
  profile:person=>json('/api/account/profile',{method:'PATCH',body:JSON.stringify(person)}),
  saveCircle:body=>json('/api/account/circles',post(body)),
  forgetCircle:id=>json(`/api/account/circles/${encodeURIComponent(id)}`,{method:'DELETE',body:'{}'}),
  circleInvite:(id,token)=>json(`/api/circle-invites/${encodeURIComponent(id)}`,{headers:{'x-circle-invite':token}}),
  joinCircle:(id,body)=>json(`/api/account/circles/${encodeURIComponent(id)}/join`,post(body)),
  circlePerson:(id,memberId,person)=>json(`/api/account/circles/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`,{method:'PATCH',body:JSON.stringify(person)}),
  placeChecks: (body,signal) => json('/api/place-checks',{...post(body),signal}),
  health: () => json("/api/health"), deck: () => json("/api/deck"),
  recommend: (body) => json("/api/recommend", {...post(body),signal:AbortSignal.timeout(45000)}),
  outing: (body) => json("/api/outings", {...post(body),signal:AbortSignal.timeout(45000)}),
  itinerary: (body,headers) => json("/api/itineraries", {...post(body),headers,signal:AbortSignal.timeout(45000)}),
  agent: (body,headers) => json("/api/agent", {...post(body),headers,signal:AbortSignal.timeout(110000)}),
  createDay: request => json('/api/days',post({request})),
  day: (id,token) => json(`/api/days/${encodeURIComponent(id)}`,dayRequest(token)),
  addPerson: (id,token,person) => json(`/api/days/${encodeURIComponent(id)}/members`,dayRequest(token,'POST',person)),
  addCircle: (id,token,circle) => json(`/api/days/${encodeURIComponent(id)}/circle`,dayRequest(token,'POST',circle)),
  joinDay: (id,token,person) => json(`/api/days/${encodeURIComponent(id)}/join`,dayRequest(token,'POST',person)),
  updatePerson: (id,token,memberId,person) => json(`/api/days/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`,dayRequest(token,'PATCH',person)),
  removePerson: (id,token,memberId) => json(`/api/days/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`,dayRequest(token,'DELETE')),
  updateDay: (id,token,request,revision) => json(`/api/days/${encodeURIComponent(id)}`,dayRequest(token,'PATCH',{request,revision})),
  autopilotDay: (id,token,request,revision) => json(`/api/days/${encodeURIComponent(id)}/autopilot`,dayRequest(token,'POST',{request,revision})),
  retryDay: (id,token) => json(`/api/days/${encodeURIComponent(id)}/retry`,dayRequest(token,'POST',{})),
  createRoom: (body) => json("/api/rooms", post(body)),
  room: (code) => json(`/api/rooms/${encodeURIComponent(code)}`),
  join: (code, body) => json(`/api/rooms/${encodeURIComponent(code)}/members`, post(body)),
  plan: (code, body = {}) => json(`/api/rooms/${encodeURIComponent(code)}/plan`, post(body)),
};
