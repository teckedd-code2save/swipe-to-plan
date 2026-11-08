// One permission request per explicit action. Area lookup receives only rounded
// coordinates; exact fixes are used only in the transient journey view.
export function roundedAreaPoint(point){return {latitude:Math.round(point.latitude*100)/100,longitude:Math.round(point.longitude*100)/100};}
export function currentDevicePoint(geolocation=globalThis.navigator?.geolocation,{maximumAge=300000}={}){
  return new Promise((resolve,reject)=>{
    if(!geolocation?.getCurrentPosition){reject(new Error('Location is unavailable. Search for your area or enter a place name.'));return;}
    geolocation.getCurrentPosition(position=>{
      const {latitude,longitude,accuracy}=position?.coords||{};
      if(!Number.isFinite(latitude)||Math.abs(latitude)>90||!Number.isFinite(longitude)||Math.abs(longitude)>180||!Number.isFinite(accuracy)||accuracy<0||accuracy>25000){reject(new Error('Your location is too broad or invalid. Search for an area or enter a place name.'));return;}
      if(position.timestamp!==undefined&&(!Number.isFinite(position.timestamp)||Date.now()-position.timestamp>Math.max(maximumAge,60000)||position.timestamp>Date.now()+60000)){reject(new Error('Your location is out of date. Try again, search for an area or enter a place name.'));return;}
      resolve({latitude,longitude,accuracy});
    },error=>reject(new Error(error?.code===1?'Location access is off. Allow it in your browser’s site settings, or search for an area or place name.':error?.code===3?'Finding your location took too long. Try again, or search for an area or place name.':'Your device couldn’t find your location. Try again, or search for an area or place name.')),{enableHighAccuracy:false,timeout:10000,maximumAge});
  });
}
export async function currentAreaPoint(geolocation=globalThis.navigator?.geolocation){return roundedAreaPoint(await currentDevicePoint(geolocation));}
