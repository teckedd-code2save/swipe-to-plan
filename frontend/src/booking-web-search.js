import {safeContactWebsite} from '../../shared/venue-contact.js';
import {reservationPreviewId} from './reservation-form-preview.js';
export function normalizeSearchFrame(value){
 if(!value||!reservationPreviewId(value.searchId)||!Number.isSafeInteger(value.sequence)||value.sequence<0||value.submitted!==false)throw Error('The search session could not be verified.');
 const url=safeContactWebsite(value.url);
 if(!url||new URL(url).protocol!=='https:'||typeof value.title!=='string'||value.title.length>500||!['ready','challenge'].includes(value.status))throw Error('The search page could not be verified.');
 if(value.width!==1100||value.height!==900||typeof value.imageDataUrl!=='string'||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value.imageDataUrl)||value.imageDataUrl.length>12000000)throw Error('The browser image could not be verified.');
 if(typeof value.expiresAt!=='string'||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)<=Date.now())throw Error('This search session expired. Start again.');
 if(value.venueName!=null&&(typeof value.venueName!=='string'||value.venueName.length>500)||value.venueAddress!=null&&(typeof value.venueAddress!=='string'||value.venueAddress.length>500))throw Error('The venue identity could not be verified.');
 return {...value,url,notice:typeof value.notice==='string'?value.notice.slice(0,500):'',canUse:value.canUse===true&&value.status==='ready'};
}
export function searchPoint(event,frame){const r=event.currentTarget.getBoundingClientRect();if(!r.width||!r.height)return null;const x=Math.floor((event.clientX-r.left)/r.width*frame.width),y=Math.floor((event.clientY-r.top)/r.height*frame.height);return x>=0&&x<frame.width&&y>=0&&y<frame.height?{x,y}:null;}
