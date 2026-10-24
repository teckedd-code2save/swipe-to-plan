import {useEffect,useRef} from 'react';
import {Icon} from './PlannerIcons.jsx';
import './location-welcome.css';

export default function LocationWelcome({onNearby,onChoose,onSkip}){
  const dialog=useRef(null),heading=useRef(null);
  useEffect(()=>{const modal=dialog.current,previous=document.activeElement;modal.showModal();heading.current.focus();return()=>{modal.close();if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
  return <dialog ref={dialog} className="location-welcome" aria-labelledby="location-welcome-title" aria-describedby="location-welcome-description" onCancel={onSkip} onClick={e=>{if(e.target===dialog.current)onSkip();}}>
    <div className="lw-content">
      <button className="lw-close" onClick={onSkip} aria-label="Skip location for now"><Icon name="close" size={19}/></button>
      <div className="lw-orbit" aria-hidden="true"><span/><i/><b><Icon name="pin" size={28}/></b><Icon name="coffee" size={20}/><Icon name="leaf" size={19}/></div>
      <p className="lw-eyebrow">A LITTLE CLOSER TO YOU</p>
      <h1 id="location-welcome-title" ref={heading} tabIndex={-1}>A good day could<br/>be closer than you think.</h1>
      <p id="location-welcome-description">Let me find the area around you, so your plans start somewhere that makes sense for you.</p>
      <button className="lw-primary" onClick={onNearby}><Icon name="pin" size={19}/>Use my location<Icon name="arrow" size={17}/></button>
      <button className="lw-secondary" onClick={onChoose}>Choose an area instead</button>
      <p className="lw-note">You choose the area before I plan. Change it anytime for a new outing.</p>
      <div className="lw-footer"><small>Approximate location. Only with permission.<br/>No live tracking.</small><button onClick={onSkip}>Not now</button></div>
    </div>
  </dialog>;
}
