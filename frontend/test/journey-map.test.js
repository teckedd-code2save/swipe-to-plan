import test,{before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {journeyPoints,mapCoordinates,markerGroups,journeyRouteGeometry} from '../src/journey-map.js';
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
test('loads map automatically, fits and rebuilds safely across scope changes',async()=>{
  let loads=0,destroys=0,fits=0,shown;
  const loadMapLibrary=async()=>{loads++;return {createJourneyMap:(_container,points)=>{shown=points;return {fit(){fits++;},destroy(){destroys++;}};}};};
  const props={plan,origin:{kind:'area',label:'Synthetic area',coordinates:{lat:1,lng:1}},routeScope:'a',loadMapLibrary};
  await render(props);assert.equal(loads,1);assert.match(document.body.textContent,/OpenStreetMap receives your IP/);assert.match(document.body.textContent,/Approximate area/);
  assert.doesNotMatch(document.body.textContent,/Load map/);assert.equal(shown.length,4);await click('Show all stops');assert.equal(fits,1);
  await render({...props,routeScope:'b'});assert.equal(destroys,1);assert.ok(document.querySelector('.journey-map-canvas'));assert.equal(loads,2);
  await render(props);assert.equal(loads,3);assert.ok(document.querySelector('.journey-map-canvas'));
});
test('tile/library failures are graceful; missing pins retain accessible stop actions',async()=>{
  let selected,handlers;
  await render({plan,onSelectStop:id=>selected=id,loadMapLibrary:async()=>({createJourneyMap:(_node,_points,events)=>{handlers=events;return {destroy(){}};}})});
  const missing=[...document.querySelectorAll('button')].find(node=>node.textContent.includes('No coordinates'));await act(async()=>missing.click());assert.equal(selected,'missing');
  await act(async()=>handlers.onTileError());assert.match(document.body.textContent,/Some map tiles are unavailable/);
});
test('fit and tile status remain in normal flow outside the map canvas',async()=>{
  let handlers,fits=0;
  await render({plan,loadMapLibrary:async()=>({createJourneyMap:(_node,_points,events)=>{handlers=events;return {fit(){fits++;},destroy(){}};}})});

  const stage=document.querySelector('.journey-map-stage'),canvas=stage.querySelector('.journey-map-canvas'),fit=stage.querySelector('.journey-map-fit');
  assert.equal(stage.firstElementChild.className,'journey-map-tools');
  assert.equal(stage.firstElementChild.nextElementSibling,canvas);
  assert.equal(fit.parentElement,stage.firstElementChild);
  assert.equal(canvas.nextElementSibling.getAttribute('role'),'status');
  fit.focus();await click('Show all stops');assert.equal(fits,1);assert.equal(document.activeElement,fit);
  await act(async()=>handlers.onTileError());
  assert.equal(canvas.nextElementSibling.className,'journey-map-status');
  const css=await readFile(new URL('../src/journey-map.css',import.meta.url),'utf8');
  const sheet=new JSDOM(`<style>${css.replace(/^@import[^;]+;/,'')}</style>`);
  try{
    const rules=[...sheet.window.document.styleSheets[0].cssRules];
    const styles=new Map(rules.filter(rule=>rule.selectorText).map(rule=>[rule.selectorText,rule.style]));
    for(const selector of ['.journey-map-fit','.journey-map-status']){
      assert.equal(styles.get(selector).position,'static','Map actions must not overlay the popup or attribution');
      assert.equal(styles.get(selector).getPropertyValue('z-index'),'');
    }
    assert.equal(styles.get('.journey-map-fit').getPropertyValue('min-height'),'44px');
    assert.equal(styles.get('.journey-map-popup button').getPropertyValue('min-height'),'44px');
    for(const rule of rules.filter(rule=>rule.cssRules))for(const nested of rule.cssRules){
      if(/journey-map-(fit|status|tools)/.test(nested.selectorText||''))assert.ok(!['absolute','fixed','sticky'].includes(nested.style?.position),'Responsive layouts must retain normal-flow controls');
    }
  }finally{sheet.window.close();}
});
test('late map import after dismissal creates no map',async()=>{
  let resolve,created=0;const loadMapLibrary=()=>new Promise(done=>resolve=done);
  await render({plan,loadMapLibrary});await act(async()=>root.unmount());root=null;
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
test('coincident 1 and 3 popup keeps each occurrence selectable and constrains long lists away from controls',async()=>{
  const {createJourneyMap}=await import('../src/journey-map-leaflet.js');
  const L=(await import('leaflet')).default,originalMap=L.map,originalObserver=globalThis.ResizeObserver;
  let leafletMap,resize,disconnected=false,adapter,width=720,height=330;
  L.map=(...args)=>(leafletMap=originalMap(...args));
  globalThis.ResizeObserver=class{constructor(callback){resize=callback;}observe(){}disconnect(){disconnected=true;}};
  const node=document.createElement('div');document.body.append(node);
  Object.defineProperty(node,'clientWidth',{get:()=>width});Object.defineProperty(node,'clientHeight',{get:()=>height});
  const selected=[],repeatedPlan={stops:[
    {id:'visit-one',item:{name:'Synthetic bakery',coordinates:{lat:0,lng:0}}},
    {id:'visit-two',item:{name:'Synthetic restaurant',coordinates:{lat:1,lng:1}}},
    {id:'visit-three',item:{name:'Synthetic bakery',coordinates:{lat:0,lng:0}}},
  ]};
  try{
    adapter=createJourneyMap(node,journeyPoints(repeatedPlan),{onSelectStop:id=>selected.push(id),onTileReady(){},onTileError(){}});
    const markers=[];leafletMap.eachLayer(layer=>{if(layer instanceof L.Marker)markers.push(layer);});
    assert.equal(markers.length,2);const marker=markers[0],popup=marker.getPopup();
    assert.equal(marker.getElement().textContent,'1·3');assert.equal(marker.getElement().getAttribute('tabindex'),'0');
    marker.openPopup();
    const choices=[...node.querySelectorAll('.journey-map-popup button')];
    assert.deepEqual(choices.map(button=>button.textContent),['1 · Synthetic bakery','3 · Synthetic bakery']);
    for(const button of choices){assert.equal(button.type,'button');button.focus();assert.equal(document.activeElement,button);button.click();}
    assert.deepEqual(selected,['visit-one','visit-three']);
    assert.equal(popup.options.keepInView,true);assert.ok(popup.options.maxWidth<=300);
    assert.equal(popup.options.minWidth,popup.options.maxWidth,'Legacy choices reserve their available width instead of shrinking to min-content');
    Object.defineProperty(leafletMap.zoomControl.getContainer(),'offsetWidth',{value:40});
    Object.defineProperty(leafletMap.attributionControl.getContainer(),'offsetHeight',{value:36});
    width=280;height=230;resize();
    assert.equal(document.activeElement,choices[1],'Resizing must retain focused occurrence controls');
    assert.ok(popup.options.maxWidth+48+popup.options.autoPanPaddingTopLeft[0]+popup.options.autoPanPaddingBottomRight[0]<=width);
    assert.equal(popup.options.minWidth,popup.options.maxWidth,'The usable minimum width follows viewport changes');
    assert.ok(popup.options.maxHeight+52+popup.options.autoPanPaddingTopLeft[1]+popup.options.autoPanPaddingBottomRight[1]<=height);
    assert.equal(popup.options.autoPanPaddingTopLeft[0],60,'Keep popup clear of the measured zoom control');
    assert.equal(popup.options.autoPanPaddingBottomRight[1],48,'Keep popup clear of wrapped attribution');
    const content=node.querySelector('.leaflet-popup-content');Object.defineProperty(content,'offsetHeight',{value:800});popup.update();
    assert.ok(content.classList.contains('leaflet-popup-scrolled'),'Long occurrence lists scroll inside the bounded popup');
    assert.equal(content.style.height,`${popup.options.maxHeight}px`);
    choices[1].focus();assert.equal(document.activeElement,choices[1]);
    assert.ok(node.querySelector('.leaflet-control-zoom-in'));assert.match(node.querySelector('.leaflet-control-attribution').textContent,/OpenStreetMap/);
    adapter.fit();assert.equal(popup.isOpen(),false,'Fit closes the popup so its auto-pan cannot fight the all-stop bounds');
    for(const point of journeyPoints(repeatedPlan).filter(point=>point.coordinates))assert.ok(leafletMap.getBounds().contains(point.coordinates));
    marker.openPopup();choices[0].click();assert.deepEqual(selected,['visit-one','visit-three','visit-one']);
  }finally{
    adapter?.destroy();L.map=originalMap;if(originalObserver===undefined)delete globalThis.ResizeObserver;else globalThis.ResizeObserver=originalObserver;node.remove();
  }
  assert.equal(disconnected,true);
});
test('group callback replaces popup with exact start/occurrence choices for pointer and keyboard activation',async()=>{
  const {createJourneyMap}=await import('../src/journey-map-leaflet.js');const L=(await import('leaflet')).default,originalMap=L.map;let instance,adapter;
  L.map=(...args)=>(instance=originalMap(...args));
  const node=document.createElement('div');document.body.append(node);Object.defineProperty(node,'clientWidth',{value:297});Object.defineProperty(node,'clientHeight',{value:176});
  const groups=[],selected=[],origin={kind:'area',label:'Synthetic start',coordinates:{lat:0,lng:0}};
  try{
    adapter=createJourneyMap(node,journeyPoints(plan,origin),{onSelectGroup:points=>groups.push(points),onSelectStop:id=>selected.push(id),onTileReady(){},onTileError(){}});
    const markers=[];instance.eachLayer(layer=>{if(layer instanceof L.Marker)markers.push(layer);});assert.equal(markers.length,1);
    const marker=markers[0],element=marker.getElement();assert.equal(marker.getPopup(),undefined);assert.equal(element.getAttribute('role'),'button');
    element.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));assert.equal(groups.length,1);assert.equal(document.activeElement,element);
    element.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(groups.length,2);
    element.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));assert.equal(groups.length,3);
    assert.deepEqual(groups[0].map(point=>point.isOrigin?'origin':point.stopId),['origin','first','repeat']);assert.deepEqual(groups[0].map(point=>point.badge),['S','1','2']);assert.equal(groups[0][0].approximate,true);assert.deepEqual(selected,[]);assert.equal(node.querySelector('.leaflet-popup'),null);
  }finally{adapter?.destroy();L.map=originalMap;node.remove();}
});
test('group delegation follows current callbacks, rejects old maps and keeps a legacy fallback',async()=>{
  const handlers=[],groups=[];const loadMapLibrary=async()=>({createJourneyMap:(_node,_points,events)=>{handlers.push(events);return {destroy(){}};}});
  const props={plan,loadMapLibrary,routeScope:'first',onSelectGroup:points=>groups.push(['first',points])};await render(props);assert.equal(typeof handlers[0].onSelectGroup,'function');
  await render({...props,onSelectGroup:points=>groups.push(['latest',points])});assert.equal(handlers.length,1);await act(async()=>handlers[0].onSelectGroup(['current']));assert.deepEqual(groups,[['latest',['current']]]);
  await render({...props,routeScope:'other-account'});await act(async()=>handlers[0].onSelectGroup(['stale']));assert.equal(groups.length,1);
  await render({...props,onSelectGroup:undefined});assert.equal(handlers.at(-1).onSelectGroup,undefined,'No callback means the adapter must retain its ordinary popup');
});
test('loaded map updates origin and stops automatically, while old callbacks are ignored',async()=>{
  let loads=0,destroys=0,selected;const handlers=[],seen=[];
  const loadMapLibrary=async()=>({createJourneyMap:(_node,points,events)=>{loads++;handlers.push(events);seen.push(points);return {destroy(){destroys++;}};}});
  const props={plan,routeScope:'account:day:view',loadMapLibrary,onSelectStop:id=>selected=id};
  await render(props);await act(async()=>handlers[0].onTileReady());
  await render({...props,origin:{kind:'current',coordinates:{lat:2,lng:3}}});
  assert.equal(loads,2);assert.equal(destroys,1);assert.deepEqual(seen[1][0].coordinates,[2,3]);
  await act(async()=>{handlers[0].onTileError();handlers[0].onSelectStop('old');});
  assert.equal(selected,undefined);assert.doesNotMatch(document.body.textContent,/Some map tiles/);
  await act(async()=>handlers[1].onTileReady());
  await render({...props,origin:{kind:'current',coordinates:{lat:2,lng:3}},plan:{stops:[...plan.stops].reverse()}});
  assert.equal(loads,3);assert.equal(document.querySelector('.journey-map-cover'),null);
  await render({...props,routeScope:'other-account:day:view'});assert.equal(destroys,3);
  await act(async()=>{handlers[2].onTileReady();handlers[2].onSelectStop('stale');});
  assert.equal(selected,undefined);assert.ok(document.querySelector('.journey-map-canvas'));
});
test('tile recovery removes error, and explicit retry replaces failed map after automatic load',async()=>{
  let loads=0,destroys=0;const handlers=[];
  const loadMapLibrary=async()=>({createJourneyMap:(_node,_points,events)=>{loads++;handlers.push(events);return {destroy(){destroys++;}};}});
  await render({plan,loadMapLibrary});await act(async()=>handlers[0].onTileError());
  assert.match(document.body.textContent,/Some map tiles/);await act(async()=>handlers[0].onTileReady());assert.doesNotMatch(document.body.textContent,/Some map tiles/);
  await act(async()=>handlers[0].onTileError());await click('Retry map');assert.equal(loads,2);assert.equal(destroys,1);
  await act(async()=>handlers[0].onTileError());assert.doesNotMatch(document.body.textContent,/Some map tiles/);
  await act(async()=>handlers[1].onTileReady());assert.equal(document.querySelector('.journey-map-status'),null);
});
test('import failures can retry after automatic load',async()=>{
  let calls=0,handlers;const loadMapLibrary=async()=>{if(++calls===1)throw Error('Synthetic import failure');return {createJourneyMap:(_node,_points,events)=>{handlers=events;return {destroy(){}};}};};
  await render({plan,loadMapLibrary});assert.match(document.body.textContent,/Map unavailable/);
  await click('Retry map');assert.equal(calls,2);await act(async()=>handlers.onTileReady());assert.equal(document.querySelector('.journey-map-status'),null);
});
test('late import from an older origin cannot create a stale map in the current scope',async()=>{
  const pending=[];let created=0;const loadMapLibrary=()=>new Promise(resolve=>pending.push(resolve));
  const props={plan,routeScope:'same-view',loadMapLibrary};await render(props);
  await render({...props,origin:{kind:'current',coordinates:{lat:1,lng:2}}});assert.equal(pending.length,2);
  const library={createJourneyMap:()=>{created++;return {destroy(){}};}};
  await act(async()=>pending[0](library));assert.equal(created,0);await act(async()=>pending[1](library));assert.equal(created,1);
});
test('12-second timeout has retry and clears when tiles subsequently load',async(t)=>{
  let handlers;const loadMapLibrary=async()=>({createJourneyMap:(_node,_points,events)=>{handlers=events;return {destroy(){}};}});
  t.mock.timers.enable({apis:['setTimeout']});await render({plan,loadMapLibrary});
  await act(async()=>t.mock.timers.tick(12001));assert.match(document.body.textContent,/Some map tiles are unavailable/);
  await act(async()=>handlers.onTileReady());assert.equal(document.querySelector('.journey-map-status'),null);
  t.mock.timers.reset();
});

const routeOrigin={kind:'current',coordinates:{lat:0.001,lng:0.001}};
function routeFixture(){return {source:'mapbox',mode:'DRIVE',selectedStops:[{id:'first'}],legs:[{from:{coordinates:routeOrigin.coordinates},to:{id:'first',coordinates:{lat:0,lng:0}}}],geometry:{type:'LineString',coordinates:[[0.001,0.001],[0.0004,0.0008],[0,0]]}};}
test('geometry belongs to the selected occurrence and actual origin/destination coordinates',()=>{
  const estimate=routeFixture(),points=journeyPoints(plan,routeOrigin);
  assert.deepEqual(journeyRouteGeometry(estimate,points,'first'),estimate.geometry);
  for(const bad of [{...estimate,source:'google_routes'},{...estimate,mode:'TRANSIT'},{...estimate,geometry:{type:'LineString',coordinates:[[50,50],[60,60]]}},{...estimate,legs:[{from:{coordinates:{lat:1,lng:1}},to:estimate.legs[0].to}]}])assert.equal(journeyRouteGeometry(bad,points,'first'),null);
  assert.equal(journeyRouteGeometry(estimate,points,'repeat'),null,'Same venue is not the same occurrence');
  assert.equal(journeyRouteGeometry(estimate,journeyPoints(plan,'Address only'),'first'),null);
});
test('route overlay clears before changed selected journey; late map imports cannot restore it',async()=>{
  const pending=[],seen=[];let cleared=0;const loadMapLibrary=()=>new Promise(resolve=>pending.push(resolve));
  const props={plan,origin:routeOrigin,selectedStopId:'first',routeEstimate:routeFixture(),loadMapLibrary};
  await render(props);await render({...props,routeEstimate:null});
  const library={createJourneyMap:(_node,_points,options)=>{seen.push(options.geometry);return {clearRoute(){cleared++;},destroy(){}};}};
  await act(async()=>pending[0](library));assert.equal(seen.length,0);
  await act(async()=>pending[1](library));assert.deepEqual(seen,[null]);
  await render(props);await act(async()=>pending[2](library));assert.equal(seen[1].type,'LineString');
  await render({...props,selectedStopId:'repeat'});assert.equal(cleared,2);assert.doesNotMatch(document.body.textContent,/Line shows/);
  await act(async()=>pending[3](library));assert.equal(seen[2],null);
});
test('Leaflet draws only actual supplied route coordinates with attribution and removes them',async()=>{
  const {createJourneyMap}=await import('../src/journey-map-leaflet.js');const L=(await import('leaflet')).default;
  const originalMap=L.map,originalSvg=L.Browser.svg;let instance;L.Browser.svg=true;L.map=(...args)=>(instance=originalMap(...args));
  const node=document.createElement('div');document.body.append(node);Object.defineProperty(node,'clientWidth',{value:320});Object.defineProperty(node,'clientHeight',{value:290});
  const geometry=routeFixture().geometry;let map;
  try{map=createJourneyMap(node,journeyPoints(plan,routeOrigin),{geometry,onTileError(){},onTileReady(){}});const lines=[];instance.eachLayer(layer=>{if(layer instanceof L.Polyline)lines.push(layer);});
    assert.equal(lines.length,1);assert.deepEqual(lines[0].getLatLngs().map(point=>[point.lng,point.lat]),geometry.coordinates);assert.equal(lines[0].options.interactive,false);assert.match(node.querySelector('.leaflet-control-attribution').textContent,/Directions © Mapbox/);assert.match(node.textContent,/OpenStreetMap/);assert.ok(node.querySelector('.leaflet-overlay-pane path'));
    map.clearRoute();assert.equal(node.querySelector('.leaflet-overlay-pane path'),null);
  }finally{map?.destroy();node.remove();L.map=originalMap;L.Browser.svg=originalSvg;}
});
