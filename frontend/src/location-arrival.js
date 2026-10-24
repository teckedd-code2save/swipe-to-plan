export const LOCATION_WELCOME_KEY='unstressed.location-welcome';
export function showLocationWelcome({ready,dismissed,area,preferred,plan,chatLength,tool,message,hash,search}){
  return !!ready&&!dismissed&&!area&&!preferred&&!plan&&!chatLength&&!tool&&!message&&(!hash||hash==='#/')&&!new URLSearchParams(search).has('signin');
}
