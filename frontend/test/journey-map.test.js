import test,{before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {journeyPoints,mapCoordinates,markerGroups} from '../src/journey-map.js';
let dom,root,createRoot,JourneyMap,bundleDir;
const plan={stops:[{id:'first',item:{name:'Synthetic public stop',coordinates:{lat:0,lng:0}}},{id:'repeat',item:{name:'Synthetic public stop',coordinates:{lat:0,lng:0}}},{id:'missing',item:{name:'No coordinates'}}]};
before(async()=>{
  dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true});
  for(const key of ['window','document','navigator','HTMLElement','Element','Node'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  ({createRoot}=await import('react-dom/client'));
  const frontend=fileURLToPath(new URL('..',import.meta.url));bundleDir=await mkdtemp(join(frontend,'node_modules/.map-test-'));
  const entry=join(bundleDir,'entry.jsx'),outfile=join(bundleDir,'map.mjs');
  await writeFile(entry,`export {default} from '${join(frontend,'src/JourneyMap.jsx')}';`);
  await build({entryPoints:[entry],outfile,bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external'});
  JourneyMap=(await import(pathToFileURL(outfile).href)).default;
});
afterEach(async()=>{if(root)await act(async()=>root.unmount());root=null;});
after(async()=>{dom.window.close();await rm(bundleDir,{recursive:true,force:true});});
async function render(props){await act(async()=>{root??=createRoot(document.getElementById('root'));root.render(React.createElement(JourneyMap,props));});}
async function click(text){const node=[...document.querySelectorAll('button')].find(node=>node.textContent===text);assert.ok(node);await act(async()=>node.click());}
test('validates real coordinate bounds without coercing malformed data',()=>{
  for(const value of [null,{}, {lat:'1',lng:2},{lat:NaN,lng:0},{lat:91,lng:0},{lat:0,lng:181}])assert.equal(mapCoordinates(value),null);
  assert.deepEqual(mapCoordinates({lat:0,lng:0}),[0,0]);assert.deepEqual(mapCoordinates({lat:-90,lng:180}),[-90,180]);
});
test('preserves repeated stop identity and co-located markers without invented offsets',()=>{
  const points=journeyPoints(plan,{kind:'area',label:'Synthetic area',coordinates:{lat:1,lng:1}});
  assert.equal(points[0].approximate,true);assert.equal(points[3].coordinates,null);
  assert.deepEqual(points.slice(1).map(point=>point.stopId),['first','repeat','missing']);
  const groups=markerGroups(points);assert.equal(groups.length,2);assert.deepEqual(groups[1].points.map(point=>point.badge),['1','2']);
  assert.equal(journeyPoints(plan,'Typed place')[0].coordinates,null);
});
test('loads map only after disclosure action, fits and tears down on scope change',async()=>{
  let loads=0,destroys=0,fits=0,shown;
  const loadMapLibrary=async()=>{loads++;return {createJourneyMap:(_container,points)=>{shown=points;return {fit(){fits++;},destroy(){destroys++;}};}};};
  const props={plan,origin:{kind:'area',label:'Synthetic area',coordinates:{lat:1,lng:1}},routeScope:'a',loadMapLibrary};
  await render(props);assert.equal(loads,0);assert.match(document.body.textContent,/OpenStreetMap receives your IP/);assert.match(document.body.textContent,/Approximate area/);
  await click('Load map');assert.equal(loads,1);assert.equal(shown.length,4);await click('Show all stops');assert.equal(fits,1);
  await render({...props,routeScope:'b'});assert.equal(destroys,1);assert.equal(document.querySelector('.journey-map-canvas'),null);assert.match(document.body.textContent,/Load map/);
  await render(props);assert.equal(loads,1);assert.equal(document.querySelector('.journey-map-canvas'),null);
});
test('tile/library failures are graceful; missing pins retain accessible stop actions',async()=>{
  let selected,handlers;
  await render({plan,onSelectStop:id=>selected=id,loadMapLibrary:async()=>({createJourneyMap:(_node,_points,events)=>{handlers=events;return {destroy(){}};}})});
  const missing=[...document.querySelectorAll('button')].find(node=>node.textContent.includes('No coordinates'));await act(async()=>missing.click());assert.equal(selected,'missing');
  await click('Load map');await act(async()=>handlers.onTileError());assert.match(document.body.textContent,/Some map tiles are unavailable/);
});
test('late map import after dismissal creates no map',async()=>{
  let resolve,created=0;const loadMapLibrary=()=>new Promise(done=>resolve=done);
  await render({plan,loadMapLibrary});await click('Load map');await act(async()=>root.unmount());root=null;
  await act(async()=>resolve({createJourneyMap:()=>{created++;}}));assert.equal(created,0);
});
test('missing coordinates never load a library and current origin label is honest',async()=>{
  let loads=0;await render({plan:{stops:[]},origin:'Typed address',loadMapLibrary:async()=>{loads++;}});assert.equal(loads,0);assert.match(document.body.textContent,/Map pins aren’t available/);
  assert.equal(journeyPoints(plan,{kind:'current',coordinates:{lat:0,lng:0}})[0].label,'Current location');
});
test('Leaflet adapter uses real positions, attribution and tile policy options without route geometry',async()=>{
  const {createJourneyMap}=await import('../src/journey-map-leaflet.js');
  const L=(await import('leaflet')).default,originalMap=L.map;let leafletMap;
  L.map=(...args)=>(leafletMap=originalMap(...args));
  const node=document.createElement('div');document.body.append(node);
  Object.defineProperty(node,'clientWidth',{value:320});Object.defineProperty(node,'clientHeight',{value:290});
  const points=journeyPoints(plan,{kind:'area',label:'Synthetic area',coordinates:{lat:1,lng:1}});
  let errors=0,ready=0;
  const map=createJourneyMap(node,points,{onTileError(){errors++;},onTileReady(){ready++;}});L.map=originalMap;
  const markers=[];let tiles;leafletMap.eachLayer(layer=>{if(layer instanceof L.Marker)markers.push(layer.getLatLng());if(layer instanceof L.TileLayer)tiles=layer;});
  assert.deepEqual(markers.map(point=>[point.lat,point.lng]),[[1,1],[0,0]]);
  for(const point of points.filter(point=>point.coordinates))assert.ok(leafletMap.getBounds().contains(point.coordinates));
  const failedTile={},goodTile={};tiles.fire('tileerror',{tile:failedTile});tiles.fire('tileload',{tile:goodTile});
  assert.equal(errors,1);assert.equal(ready,0,'An unrelated success must not hide a failed tile');
  tiles.fire('tileload',{tile:failedTile});assert.equal(ready,1,'Recovered failed tile restores ready');
  tiles.fire('tileerror',{tile:failedTile});tiles.fire('tileunload',{tile:failedTile});assert.equal(ready,2,'Failure leaving viewport cannot poison remaining loaded tiles');
  assert.equal(node.querySelectorAll('.journey-map-marker').length,2);
  assert.match(node.textContent,/OpenStreetMap/);assert.match(node.textContent,/1·2/);
  assert.equal(node.querySelectorAll('.leaflet-overlay-pane svg path').length,0,'No invented route geometry');
  const tile=node.querySelector('img.leaflet-tile');assert.ok(tile);assert.match(tile.src,/^https:\/\/tile.openstreetmap.org\//);assert.equal(tile.referrerPolicy,'strict-origin-when-cross-origin');
  assert.match(node.querySelector('.journey-map-marker').title,/approximate area/);
  map.fit();map.destroy();assert.equal(node.querySelectorAll('.leaflet-pane').length,0);node.remove();
});
test('loaded map updates origin and stops without repeat consent, while old callbacks are ignored',async()=>{
  let loads=0,destroys=0,selected;const handlers=[],seen=[];
  const loadMapLibrary=async()=>({createJourneyMap:(_node,points,events)=>{loads++;handlers.push(events);seen.push(points);return {destroy(){destroys++;}};}});
  const props={plan,routeScope:'account:day:view',loadMapLibrary,onSelectStop:id=>selected=id};
  await render(props);await click('Load map');await act(async()=>handlers[0].onTileReady());
  await render({...props,origin:{kind:'current',coordinates:{lat:2,lng:3}}});
  assert.equal(loads,2);assert.equal(destroys,1);assert.deepEqual(seen[1][0].coordinates,[2,3]);
  await act(async()=>{handlers[0].onTileError();handlers[0].onSelectStop('old');});
  assert.equal(selected,undefined);assert.doesNotMatch(document.body.textContent,/Some map tiles/);
  await act(async()=>handlers[1].onTileReady());
  await render({...props,origin:{kind:'current',coordinates:{lat:2,lng:3}},plan:{stops:[...plan.stops].reverse()}});
  assert.equal(loads,3);assert.equal(document.querySelector('.journey-map-cover'),null);
  await render({...props,routeScope:'other-account:day:view'});assert.equal(destroys,3);
  await act(async()=>{handlers[2].onTileReady();handlers[2].onSelectStop('stale');});
  assert.equal(selected,undefined);assert.equal(document.querySelector('.journey-map-canvas'),null);
});
test('tile recovery removes error, and explicit retry replaces failed map without consent',async()=>{
  let loads=0,destroys=0;const handlers=[];
  const loadMapLibrary=async()=>({createJourneyMap:(_node,_points,events)=>{loads++;handlers.push(events);return {destroy(){destroys++;}};}});
  await render({plan,loadMapLibrary});await click('Load map');await act(async()=>handlers[0].onTileError());
  assert.match(document.body.textContent,/Some map tiles/);await act(async()=>handlers[0].onTileReady());assert.doesNotMatch(document.body.textContent,/Some map tiles/);
  await act(async()=>handlers[0].onTileError());await click('Retry map');assert.equal(loads,2);assert.equal(destroys,1);
  await act(async()=>handlers[0].onTileError());assert.doesNotMatch(document.body.textContent,/Some map tiles/);
  await act(async()=>handlers[1].onTileReady());assert.equal(document.querySelector('.journey-map-status'),null);
});
test('import failures can retry without repeating consent',async()=>{
  let calls=0,handlers;const loadMapLibrary=async()=>{if(++calls===1)throw Error('Synthetic import failure');return {createJourneyMap:(_node,_points,events)=>{handlers=events;return {destroy(){}};}};};
  await render({plan,loadMapLibrary});await click('Load map');assert.match(document.body.textContent,/Map unavailable/);
  await click('Retry map');assert.equal(calls,2);await act(async()=>handlers.onTileReady());assert.equal(document.querySelector('.journey-map-status'),null);
});
test('late import from an older origin cannot create a stale map in the current scope',async()=>{
  const pending=[];let created=0;const loadMapLibrary=()=>new Promise(resolve=>pending.push(resolve));
  const props={plan,routeScope:'same-view',loadMapLibrary};await render(props);await click('Load map');
  await render({...props,origin:{kind:'current',coordinates:{lat:1,lng:2}}});assert.equal(pending.length,2);
  const library={createJourneyMap:()=>{created++;return {destroy(){}};}};
  await act(async()=>pending[0](library));assert.equal(created,0);await act(async()=>pending[1](library));assert.equal(created,1);
});
test('12-second timeout has retry and clears when tiles subsequently load',async(t)=>{
  let handlers;const loadMapLibrary=async()=>({createJourneyMap:(_node,_points,events)=>{handlers=events;return {destroy(){}};}});
  await render({plan,loadMapLibrary});t.mock.timers.enable({apis:['setTimeout']});await click('Load map');
  await act(async()=>t.mock.timers.tick(12001));assert.match(document.body.textContent,/Some map tiles are unavailable/);
  await act(async()=>handlers.onTileReady());assert.equal(document.querySelector('.journey-map-status'),null);
  t.mock.timers.reset();
});
