import {useId} from 'react';

// A compass and guiding spark extend the studio's existing sun/wayfinding motif.
export default function AutopilotControl({active,disabled,onToggle}){
  const hint=useId();
  return <span className="cs-pilot-wrap">
    <button type="button" className="cs-pilot" role="switch" aria-checked={active} aria-label="Autopilot" aria-describedby={hint} disabled={disabled} onClick={onToggle}>
      <svg viewBox="0 0 28 28" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21.5 11.5a9 9 0 1 1-6-6"/>
        <path d="m17.5 10.5-3 7-6 2 3-7z"/><path d="m11.5 12.5 3 5"/>
        <path d="m22 2 .9 3.1L26 6l-3.1.9L22 10l-.9-3.1L18 6l3.1-.9z" fill="currentColor" stroke="none"/>
      </svg>
      {active&&<i aria-hidden="true"/>}
    </button>
    <span className="cs-pilot-hint" id={hint} role="tooltip"><strong>Autopilot {active?'on':'off'}</strong><span>{active?'I’ll shape the plan and check the details.':'Let me bring the plan together.'}</span></span>
  </span>;
}
