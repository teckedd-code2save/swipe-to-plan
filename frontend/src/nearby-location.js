// Called only after a person chooses the current-location action. No tracking.
export function currentAreaPoint(geolocation=globalThis.navigator?.geolocation){
  return new Promise((resolve,reject)=>{
    if(!geolocation){reject(new Error('Location isn’t available in this browser. Search for your area below.'));return;}
    geolocation.getCurrentPosition(position=>{
      const {latitude,longitude,accuracy}=position.coords;
      if(!Number.isFinite(latitude)||Math.abs(latitude)>90||!Number.isFinite(longitude)||Math.abs(longitude)>180||!Number.isFinite(accuracy)||accuracy>25000){
        reject(new Error('Your location is too broad to suggest a neighborhood. Search for your city or area below.'));return;
      }
      resolve({latitude:Math.round(latitude*100)/100,longitude:Math.round(longitude*100)/100});
    },error=>reject(new Error(error.code===1?'Location access is off. You can allow it in your browser’s site settings, or search below.':error.code===3?'Finding your location took too long. Try again, or search below.':'Your device couldn’t find your location. Try again, or search below.')),{enableHighAccuracy:false,timeout:10000,maximumAge:300000});
  });
}
