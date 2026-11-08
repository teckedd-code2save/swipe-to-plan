import test from 'node:test';
import assert from 'node:assert/strict';
import {createRouteActions} from '../src/route-actions.js';
const now=()=>Date.parse('2026-11-08T12:00:00Z'),secret='fixture-DO-NOT-EXPOSE-token';
const raw=()=>({requestId:'req-1',itineraryRevision:2,mode:'DRIVE',origin:{id:'visit-1',entityId:'same-venue',coordinates:{lat:0,lng:0}},stops:[{id:'visit-2',entityId:'same-venue',coordinates:{lat:0.01,lng:0.01}}]});
const route=()=>({distance:1500.25,duration:300.5,legs:[{distance:1500.25,duration:300.5}],geometry:{type:'LineString',coordinates:[[0,0],[0.001,0.002],[0.01,0.01]]}});
const data=()=>({code:'Ok',routes:[route()]});
const response=(body=data(),status=200)=>new Response(JSON.stringify(body),{status});
const service=(fetchImpl=async()=>response(),extra={})=>createRouteActions({budget:{configured:true,claim:async()=>{}},provider:'mapbox',enabled:true,displayContext:'osm',mapboxToken:secret,fetchImpl,now,...extra});
const rejects=async(action,code)=>assert.rejects(action,error=>{assert.equal(error.code,code);assert.doesNotMatch(JSON.stringify(error)+error.message,/DO-NOT-EXPOSE/);return true;});

test('activation requires explicit provider, switch and separate token; Google never runs with OSM',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;return response();};
  for(const options of [{},{apiKey:secret},{mapboxToken:secret},{enabled:true,mapboxToken:secret},{provider:'mapbox',mapboxToken:secret},{enabled:true,provider:'mapbox'},{enabled:'1',provider:'mapbox',mapboxToken:secret},{enabled:true,provider:'unknown',mapboxToken:secret},{enabled:true,provider:'toString',mapboxToken:secret}]){
    const api=createRouteActions({...options,fetchImpl});assert.equal(api.capabilities().routeEstimates,false);await rejects(api.estimate(raw()),'provider_not_configured');
  }
  const google=createRouteActions({enabled:true,provider:'google_routes',googleApiKey:secret,displayContext:'osm',fetchImpl});
  assert.equal(google.capabilities().routeEstimates,false);await rejects(google.estimate(raw()),'provider_display_incompatible');assert.equal(calls,0);
  assert.deepEqual(service().capabilities(),{routeEstimates:true,routeProvider:'mapbox',displayContext:'osm',displayCompatible:true,requestLimitConfigured:true,modes:['DRIVE','WALK'],coordinatesRequired:true,routeGeometry:true,bookingSubmission:false,confirmedBookings:false});
});
for(const mode of ['DRIVE','WALK'])test(`Mapbox ${mode} uses one coordinate-only request and preserves measurement and occurrence binding`,async()=>{
  let calls=0;const body={...raw(),mode},before=structuredClone(body);
  const result=await service(async(input,options)=>{
    calls++;const url=new URL(input);assert.equal(url.origin,'https://api.mapbox.com');assert.match(url.pathname,new RegExp(`/mapbox/${mode==='DRIVE'?'driving-traffic':'walking'}/0,0;0.01,0.01$`));
    assert.equal(url.searchParams.get('access_token'),secret);assert.equal(url.searchParams.get('overview'),'simplified');assert.equal(url.searchParams.get('geometries'),'geojson');assert.equal(url.searchParams.get('radiuses'),'1000;1000');assert.equal(url.searchParams.get('steps'),'false');assert.equal(url.searchParams.has('depart_at'),false);
    assert.equal(options.redirect,'error');assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.ok(options.signal instanceof AbortSignal);
    const payload=data();payload.routes[0].secret=secret;payload.routes[0].geometry.secret=secret;payload.message=secret;return response(payload);
  }).estimate(body);
  assert.equal(calls,1);assert.deepEqual(body,before);assert.equal(result.source,'mapbox');assert.equal(result.requestId,body.requestId);assert.equal(result.itineraryRevision,2);assert.equal(result.legs[0].from.id,'visit-1');assert.equal(result.legs[0].to.id,'visit-2');assert.equal(result.legs[0].from.entityId,result.legs[0].to.entityId);
  assert.deepEqual(result.geometry,route().geometry);assert.equal(result.distanceMeters,1500.25);assert.equal(result.durationSeconds,300.5);assert.equal(result.trafficAware,mode==='DRIVE');assert.equal(result.trafficBasis,mode==='DRIVE'?'live_and_typical_where_available':'not_applicable');assert.equal(result.scheduleFeasibility,'not_evaluated');assert.equal(result.includesVisitDurations,false);assert.equal(result.includesPlanningBuffers,false);assert.equal(result.departureAt,undefined);assert.equal(result.legs[0].departureAt,null);
  assert.doesNotMatch(JSON.stringify(result),/DO-NOT-EXPOSE|access_token/);assert.equal(new URL(result.navigationUrl).hostname,'www.google.com');
});
test('unsupported transit, address-only starts/destinations and scheduled times do not make calls',async()=>{
  let calls=0;const api=service(async()=>{calls++;return response();});
  await rejects(api.estimate({...raw(),mode:'TRANSIT'}),'routes_unsupported_mode');
  for(const body of [{...raw(),origin:{address:'Synthetic address'}},{...raw(),stops:[{id:'stop',address:'Synthetic address'}]}])await rejects(api.estimate(body),'routes_coordinates_required');
  await rejects(api.estimate({...raw(),departureAt:'2027-01-01T12:00:00Z'}),'routes_departure_unsupported');
  for(const coordinates of [{lat:91,lng:0},{lat:0,lng:181},{lat:0,lng:'1'},{lat:NaN,lng:1},{lat:0,lng:Infinity}])await rejects(api.estimate({...raw(),origin:{coordinates}}),'invalid_request');
  assert.equal(calls,0);
});
for(const [status,code] of [[429,'routes_rate_limited'],[401,'routes_provider_error'],[403,'routes_provider_error'],[422,'routes_provider_error'],[500,'routes_provider_error'],[503,'routes_provider_error']])test(`HTTP ${status} redacts upstream failures and never retries`,async()=>{
  let calls=0;await rejects(service(async()=>{calls++;return response({code:secret,message:secret},status);}).estimate(raw()),code);assert.equal(calls,1);
});
test('network errors and malformed body details never reach results',async()=>{
  await rejects(service(async()=>{throw Error(`https://api.mapbox.com/?access_token=${secret}`);}).estimate(raw()),'routes_unreachable');
  await rejects(service(async()=>new Response(secret)).estimate(raw()),'routes_bad_response');
  await rejects(service(async()=>new Response(' '.repeat(1024*1024+1))).estimate(raw()),'routes_bad_response');
  await rejects(service(async()=>new Response('{}',{headers:{'content-length':String(1024*1024+1)}})).estimate(raw()),'routes_bad_response');
});
test('timeout bounds headers and streaming bodies, aborts once and does not retry',async()=>{
  for(const bodyStalls of [false,true]){
    let calls=0,signal;const api=service(async(_url,options)=>{calls++;signal=options.signal;return bodyStalls?new Response(new ReadableStream({start(){}})):new Promise(()=>{});},{timeoutMs:10});
    await rejects(api.estimate(raw()),'routes_timeout');assert.equal(signal.aborted,true);assert.equal(calls,1);
  }
});
test('no routes and no matching road segment are controlled failures',async()=>{
  for(const body of [{code:'NoRoute'},{code:'NoSegment'},{code:'Ok',routes:[]}])await rejects(service(async()=>response(body)).estimate(raw()),'route_not_found');
});
test('invalid provider measurements, geometry bounds and wrong endpoints cannot fabricate a line',async()=>{
  for(const patch of [{distance:-1},{distance:'3'},{duration:null},{duration:-1},{legs:[]},{legs:[{distance:1,duration:1},{distance:1,duration:1}]},{geometry:null},{geometry:{type:'Polygon',coordinates:[]}},{geometry:{type:'LineString',coordinates:[[0,0]]}},{geometry:{type:'LineString',coordinates:[[0,0],[181,0]]}},{geometry:{type:'LineString',coordinates:[[0,0],['0.01',0.01]]}},{geometry:{type:'LineString',coordinates:[[0,0],[0.01,0.01,1]]}},{geometry:{type:'LineString',coordinates:[[30,30],[30,30]]}},{geometry:{type:'LineString',coordinates:Array.from({length:5001},()=>[0,0])}}]){
    await rejects(service(async()=>response({code:'Ok',routes:[{...route(),...patch}]})).estimate(raw()),'routes_bad_response');
  }
  for(const body of [null,[],{},'secret',{code:'Unknown',message:secret},{code:'Ok',routes:null},{code:'Ok',routes:[route(),route()]}])await rejects(service(async()=>response(body)).estimate(raw()),'routes_bad_response');
  const zero={...route(),distance:0,duration:0,legs:[{distance:0,duration:0}]};const result=await service(async()=>response({code:'Ok',routes:[zero]})).estimate(raw());assert.equal(result.durationSeconds,0);
});
test('out-of-order requests retain their own returned geometry, selection and correlation',async()=>{
  let finish;const pending=service(()=>new Promise(resolve=>finish=resolve)).estimate(raw());
  const next={...raw(),requestId:'req-2',itineraryRevision:3};const latest=await service().estimate(next);finish(response());const earlier=await pending;
  assert.equal(latest.requestId,'req-2');assert.equal(earlier.requestId,'req-1');assert.equal(earlier.itineraryRevision,2);assert.equal(latest.itineraryRevision,3);
});

test('rejected HTTP and oversized-header response bodies are closed rather than draining indefinitely',async()=>{
  for(const [status,headers,code] of [[429,{},'routes_rate_limited'],[503,{},'routes_provider_error'],[200,{'content-length':String(1024*1024+1)},'routes_bad_response']]){
    let cancelled=0,signal;const stream=new ReadableStream({cancel(){cancelled++;}});
    await rejects(service(async(_url,options)=>{signal=options.signal;return new Response(stream,{status,headers});}).estimate(raw()),code);
    assert.equal(signal.aborted,true);assert.equal(cancelled,1);
  }
});
test('a stalled streaming body is actively cancelled at the deadline',async()=>{
  let cancelled=0;const stream=new ReadableStream({cancel(){cancelled++;}});
  await rejects(service(async()=>new Response(stream),{timeoutMs:10}).estimate(raw()),'routes_timeout');assert.equal(cancelled,1);
});

test('a stalled cancellation hook cannot defeat the route deadline',async()=>{
  const stream=new ReadableStream({cancel(){return new Promise(()=>{});}});
  const result=service(async()=>new Response(stream,{status:503}),{timeoutMs:10}).estimate(raw());
  await rejects(Promise.race([result,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('cancellation hung')),250);timer.unref();})]),'routes_provider_error');
});

test('a transport returning headers after timeout cannot retain a late response body',async()=>{
  let finish,cancelled=0;const pending=service(()=>new Promise(resolve=>finish=resolve),{timeoutMs:10}).estimate(raw());
  await rejects(pending,'routes_timeout');finish(new Response(new ReadableStream({cancel(){cancelled++;}})));await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled,1);
});
