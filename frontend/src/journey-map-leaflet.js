import L from 'leaflet';
import {markerGroups} from './journey-map.js';

export function createJourneyMap(container,points,{onSelectStop,onSelectStart,onSelectGroup,onTileError,onTileReady,geometry=null}) {
  const map=L.map(container,{scrollWheelZoom:false,attributionControl:true,zoomControl:true,zoomAnimation:false,fadeAnimation:false});
  const located=points.filter(point=>point.coordinates);
  const routePoints=geometry?.type==='LineString'?geometry.coordinates.map(([lng,lat])=>[lat,lng]):[];
  const bounds=[...located.map(point=>point.coordinates),...routePoints];
  function fit(){
    map.closePopup();
    map.invalidateSize();
    if(bounds.length===1)map.setView(bounds[0],14,{animate:false});
    else if(bounds.length)map.fitBounds(bounds,{padding:[38,38],maxZoom:15,animate:false});
  }
  fit();
  // Direct browser images preserve native HTTP caching and browser identification.
  // Only visible tiles; no prefetch, offline cache, proxy or location API calls.
  const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,keepBuffer:0,updateWhenIdle:true,referrerPolicy:'strict-origin-when-cross-origin',
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  });
  // A success must not hide another tile's failure. Unloaded tiles no longer
  // describe the current view; retry constructs a fresh layer using normal cache.
  const failedTiles=new Set(),loadedTiles=new Set();
  const reportReady=()=>{if(!failedTiles.size&&loadedTiles.size)onTileReady();};
  tiles.on('tileerror',({tile})=>{failedTiles.add(tile);loadedTiles.delete(tile);onTileError();});
  tiles.on('tileload',({tile})=>{failedTiles.delete(tile);loadedTiles.add(tile);reportReady();});
  tiles.on('tileunload',({tile})=>{failedTiles.delete(tile);loadedTiles.delete(tile);reportReady();});
  tiles.addTo(map);
  let routeLine=routePoints.length?L.polyline(routePoints,{color:'#6751c7',weight:5,opacity:0.85,interactive:false}).addTo(map):null;
  if(routeLine)map.attributionControl.addAttribution('Directions © <a href="https://www.mapbox.com/" target="_blank" rel="noopener">Mapbox</a>');
  function clearRoute(){if(routeLine){routeLine.remove();routeLine=null;}}
  const popups=[],markers=[];
  function popupOptions(){
    const size=map.getSize();
    // Keep native zoom controls and attribution visible. Leaflet's popup content
    // adds 46px horizontally and 48px vertically (margins, wrapper and tip).
    const left=Math.max(32,map.zoomControl.getContainer().offsetWidth)+20;
    const bottom=Math.max(20,map.attributionControl.getContainer().offsetHeight)+12;
    const width=Math.max(80,Math.min(300,size.x-left-12-48));
    // Grid content can otherwise shrink to its min-content width during Leaflet
    // measurement. Reserve the bounded available width for the legacy chooser.
    return {minWidth:width,maxWidth:width,maxHeight:Math.max(48,Math.min(240,size.y-12-bottom-52)),autoPanPaddingTopLeft:[left,12],autoPanPaddingBottomRight:[12,bottom],keepInView:true};
  }
  function action(marker,choose){
    const activate=()=>{marker.getElement()?.focus({preventScroll:true});choose();};
    marker.on('click',activate);
    marker.on('keydown',event=>{const key=event.originalEvent;if(key&&!key.repeat&&['Enter',' '].includes(key.key)){L.DomEvent.preventDefault(key);activate();}});
  }
  for(const group of markerGroups(points)){
    const badge=document.createElement('span');badge.className='journey-map-pin';
    badge.textContent=group.points.map(point=>point.badge).join('·');
    if(group.points.some(point=>point.isOrigin))badge.classList.add('journey-map-pin-start');
    const label=group.points.map(point=>`${point.isOrigin?'Start':`Stop ${point.badge}`}: ${point.label}${point.approximate?' (approximate area)':''}`).join('; ');
    const marker=L.marker(group.coordinates,{icon:L.divIcon({html:badge,className:'journey-map-marker',iconSize:[40,40],iconAnchor:[20,40]}),title:label,alt:label,keyboard:true}).addTo(map);
    markers.push({marker,group});
    // A unique marker opens the visit directly. Co-located visits keep an explicit chooser.
    if(group.points.length===1){
      const point=group.points[0];
      action(marker,()=>point.isOrigin?onSelectStart?.():onSelectStop?.(point.stopId));
      continue;
    }
    if(onSelectGroup){action(marker,()=>onSelectGroup(group.points));continue;}
    const popup=document.createElement('div');popup.className='journey-map-popup';
    for(const point of group.points){
      const node=document.createElement('button');node.textContent=`${point.badge} · ${point.label}${point.approximate?' (approximate area)':''}`;
      node.type='button';node.addEventListener('click',()=>point.isOrigin?onSelectStart?.():onSelectStop?.(point.stopId));
      popup.append(node);
    }
    marker.bindPopup(popup,popupOptions());
    popups.push(marker.getPopup());
  }
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>{
    map.invalidateSize();
    const options=popupOptions();
    for(const popup of popups){
      L.setOptions(popup,options);
      if(popup.isOpen()){
        const element=popup.getElement(),focused=container.ownerDocument.activeElement,restoreFocus=element.contains(focused);
        const content=element.querySelector('.leaflet-popup-content'),scrollTop=content.scrollTop;
        // Leaflet detaches and reattaches popup contents during update. Keep a
        // keyboard user's place instead of dropping focus onto the page body.
        popup.update();content.scrollTop=scrollTop;
        if(restoreFocus)focused.focus({preventScroll:true});
      }
    }
  }):null;
  observer?.observe(container);
  function select(stopId){for(const {marker,group} of markers){const active=group.points.some(point=>point.stopId===stopId);marker.getElement()?.classList.toggle('journey-map-marker-selected',active);marker.getElement()?.setAttribute('aria-pressed',String(active));}}
  return {fit,clearRoute,select,destroy(){observer?.disconnect();tiles.off();map.remove();}};
}
