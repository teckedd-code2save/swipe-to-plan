// Ephemeral, provider-neutral route facade. No environment reads or persistence.
import { ROUTE_PROVIDERS, providerSupportsDisplay } from '../../shared/route-provider.js';
import { RouteActionError, parseRouteRequest } from './route-contract.js';
import { createGoogleRouteAdapter } from './route-google.js';
import { createMapboxRouteAdapter } from './route-mapbox.js';
export { RouteActionError, parseRouteRequest } from './route-contract.js';
export { buildGoogleRouteRequest } from './route-google.js';

export function createRouteActions({provider='none',enabled=false,displayContext='osm',mapboxToken,googleApiKey,budget,fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=12000}={}){
  const descriptor=Object.hasOwn(ROUTE_PROVIDERS,provider)?ROUTE_PROVIDERS[provider]:null;
  const compatible=providerSupportsDisplay(provider,displayContext);
  const token=provider==='mapbox'?mapboxToken:provider==='google_routes'?googleApiKey:null;
  const limitConfigured=budget?.configured===true&&typeof budget.claim==='function';
  const configured=enabled===true&&compatible&&limitConfigured&&typeof token==='string'&&!!token.trim();
  const adapter=configured?(provider==='mapbox'?createMapboxRouteAdapter({token,fetchImpl,now,timeoutMs}):createGoogleRouteAdapter({apiKey:token,fetchImpl,now,timeoutMs})):null;
  return {
    capabilities:()=>({routeEstimates:configured,routeProvider:descriptor?provider:null,displayContext,displayCompatible:compatible,
      requestLimitConfigured:limitConfigured,modes:descriptor?[...descriptor.modes]:[],coordinatesRequired:descriptor?.coordinatesRequired??false,routeGeometry:configured&&descriptor.geometry,
      bookingSubmission:false,confirmedBookings:false}),
    async estimate(raw){
      const brief=parseRouteRequest(raw,{now});
      if(enabled===true&&descriptor&&!compatible)throw new RouteActionError('provider_display_incompatible');
      if(!configured)throw new RouteActionError('provider_not_configured');
      adapter.validate?.(brief);
      // A committed slot is required before any outbound I/O, including failures.
      await budget.claim();
      return adapter.estimate(brief);
    },
  };
}
