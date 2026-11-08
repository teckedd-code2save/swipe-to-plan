import L from 'leaflet';
import {markerGroups} from './journey-map.js';

export function createJourneyMap(container,points,{onSelectStop,onTileError,onTileReady}) {
  const map=L.map(container,{scrollWheelZoom:false,attributionControl:true,zoomControl:true,zoomAnimation:false,fadeAnimation:false});
  const located=points.filter(point=>point.coordinates);
  function fit(){
    map.invalidateSize();
    if(located.length===1)map.setView(located[0].coordinates,14,{animate:false});
    else if(located.length)map.fitBounds(located.map(point=>point.coordinates),{padding:[38,38],maxZoom:15,animate:false});
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
  for(const group of markerGroups(points)){
    const badge=document.createElement('span');badge.className='journey-map-pin';
    badge.textContent=group.points.map(point=>point.badge).join('·');
    if(group.points.some(point=>point.isOrigin))badge.classList.add('journey-map-pin-start');
    const label=group.points.map(point=>`${point.isOrigin?'Start':`Stop ${point.badge}`}: ${point.label}${point.approximate?' (approximate area)':''}`).join('; ');
    const marker=L.marker(group.coordinates,{icon:L.divIcon({html:badge,className:'journey-map-marker',iconSize:[40,40],iconAnchor:[20,40]}),title:label,alt:label,keyboard:true}).addTo(map);
    const popup=document.createElement('div');popup.className='journey-map-popup';
    for(const point of group.points){
      const node=document.createElement(point.isOrigin?'span':'button');node.textContent=`${point.badge} · ${point.label}${point.approximate?' (approximate area)':''}`;
      if(!point.isOrigin){node.type='button';node.addEventListener('click',()=>onSelectStop?.(point.stopId));}
      popup.append(node);
    }
    marker.bindPopup(popup);
  }
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>map.invalidateSize()):null;
  observer?.observe(container);
  return {fit,destroy(){observer?.disconnect();tiles.off();map.remove();}};
}
