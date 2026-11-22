// Exact public-apis listing: https://github.com/lachy3433/contextfetch-mcp
// REST contract from its MIT-licensed MCP client: POST /v1/search.
// Keyless default for the booking-link search only. An explicit false value disables it.
const LIMIT = 500000;
export function createContextFetchBookingSearch({apiKey='keyless',fetchImpl=fetch}={}) {
  return {provider:'contextfetch',enabled:true,async search(query,{signal}={}) {
    if (typeof query !== 'string' || !query.trim() || query.length > 650) throw Object.assign(Error('search_failed'),{code:'search_failed'});
    const timeout=AbortSignal.timeout(10000),combined=signal?AbortSignal.any([timeout,signal]):timeout;
    try {
      const response=await fetchImpl('https://api.contextfetch.dev/v1/search',{
        method:'POST',redirect:'error',signal:combined,
        headers:{accept:'application/json','content-type':'application/json',authorization:'Bearer '+(apiKey||'keyless')},
        body:JSON.stringify({query,numResults:10,userLocation:'GH',language:'en',contents:{text:false,highlights:true,pruned_context:true}})
      });
      if (response.status===402 || response.status===429) throw Object.assign(Error('search_rate_limited'),{code:'search_rate_limited'});
      if (!response.ok) throw Object.assign(Error(response.status===401||response.status===403?'search_unavailable':'search_failed'),{code:response.status===401||response.status===403?'search_unavailable':'search_failed'});
      if (Number(response.headers.get('content-length')) > LIMIT) throw Error('search_failed');
      let raw='';
      if(response.body?.getReader) {
        const reader=response.body.getReader(),chunks=[];let size=0;
        try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>LIMIT)throw Error('search_failed');chunks.push(Buffer.from(value));}}
        finally {await reader.cancel().catch(()=>{});}
        raw=Buffer.concat(chunks).toString('utf8');
      } else raw=await response.text();
      if(raw.length>LIMIT)throw Error('search_failed');
      const data=JSON.parse(raw);
      if(!Array.isArray(data?.results))throw Error('search_failed');
      return data.results.slice(0,10).map(item=>({
        title:String(item?.title||'').slice(0,200),
        url:item?.url,
        description:String(item?.prunedContext||item?.highlights?.join(' ')||item?.text||'').slice(0,600)
      }));
    } catch (error) {
      const code=signal?.aborted?'expired':timeout.aborted||error?.name==='TimeoutError'?'search_timeout':error?.code;
      throw Object.assign(Error(['expired','search_timeout','search_rate_limited','search_unavailable'].includes(code)?code:'search_failed'),{code:['expired','search_timeout','search_rate_limited','search_unavailable'].includes(code)?code:'search_failed'});
    }
  }};
}
export function configuredContextFetchBookingSearch(env=process.env) {
  if(env.CONTEXTFETCH_BOOKING_ENABLED==='false')return null;
  return createContextFetchBookingSearch({apiKey:env.CONTEXTFETCH_API_KEY||'keyless'});
}

