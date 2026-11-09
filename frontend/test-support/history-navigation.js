// Register before initiating navigation: Close, Escape and timing apply all
// finish when ReadySheet handles popstate, not after a fixed number of ms.
// Call inside React act so its completion also flushes the resulting UI update.
export function historyTraversal(action,{target=window,timeoutMs=2000}={}) {
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);target.removeEventListener('popstate',complete);};
    const complete=event=>{cleanup();resolve(event);};
    const timer=setTimeout(()=>{cleanup();reject(new Error(`Expected popstate was not received within ${timeoutMs} ms.`));},timeoutMs);
    target.addEventListener('popstate',complete);
    try{action();}catch(error){cleanup();reject(error);}
  });
}
