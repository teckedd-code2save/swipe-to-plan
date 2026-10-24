let session;
export function usageSession(){
  if(!session){try{session=sessionStorage.getItem('unstressed.usage-session');if(!session){session=crypto.randomUUID();sessionStorage.setItem('unstressed.usage-session',session);}}catch{session=crypto.randomUUID();}}
  return session;
}
export function track(event){
  if(navigator.globalPrivacyControl)return;
  fetch('/api/usage',{method:'POST',headers:{'content-type':'application/json','x-unstressed-session':usageSession()},body:JSON.stringify({event}),keepalive:true}).catch(()=>{});
}
