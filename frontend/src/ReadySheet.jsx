import {useId,useLayoutEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from './PlannerIcons.jsx';

// One native modal surface for all getting-ready decisions. The browser supplies
// the focus trap and inert background; an in-place history entry handles Back.
export default function ReadySheet({title,subtitle,viewKey,onClose,onBack,children,footer,dismissRef,returnFocusRef,canRestoreFocus=()=>true}) {
  const dialog=useRef(null),heading=useRef(null),scroll=useRef(null),close=useRef(onClose),navigation=useRef(null),id=useId();
  close.current=onClose;
  useLayoutEffect(()=>{
    const element=dialog.current,trigger=document.activeElement,overflow=document.body.style.overflow;
    const token=`ready-${crypto.randomUUID()}`,previous=window.history.state;
    const pop=()=>{const afterClose=navigation.current?.afterClose;navigation.current=null;close.current();if(canRestoreFocus())afterClose?.();};
    navigation.current={token,previous,dismissing:false,afterClose:null};
    window.history.pushState({...previous,readySheet:token},'');
    window.addEventListener('popstate',pop);
    document.body.style.overflow='hidden';element.showModal();heading.current?.focus({preventScroll:true});
    return()=>{
      window.removeEventListener('popstate',pop);element.close();document.body.style.overflow=overflow;
      // Never navigate after the user has already moved elsewhere.
      if(window.history.state?.readySheet===token)window.history.replaceState(previous,'');
      navigation.current=null;
      if(dismissRef)dismissRef.current=null;
      if(canRestoreFocus()){
        if(trigger?.isConnected&&!element.contains(trigger)&&!trigger.disabled)trigger.focus({preventScroll:true});
        else returnFocusRef?.current?.focus({preventScroll:true});
      }
    };
  },[]);
  useLayoutEffect(()=>{if(scroll.current)scroll.current.scrollTop=0;heading.current?.focus({preventScroll:true});},[viewKey]);
  function dismiss(afterClose){
    const nav=navigation.current;
    if(nav?.dismissing)return;
    if(nav&&window.history.state?.readySheet===nav.token){
      nav.dismissing=true;nav.afterClose=typeof afterClose==='function'?afterClose:null;window.history.back();
    }else{close.current();if(typeof afterClose==='function')afterClose();}
  }
  useLayoutEffect(()=>{if(dismissRef)dismissRef.current=dismiss;});
  return createPortal(<dialog className="gr-sheet" ref={dialog} aria-labelledby={id} onCancel={event=>{event.preventDefault();dismiss();}} onKeyDown={event=>event.stopPropagation()}>
    <div className="gr-sheet-handle" aria-hidden="true"/>
    <header className="gr-sheet-header">{onBack&&<button className="gr-icon-button" type="button" onClick={onBack} aria-label="Back to previous sheet"><Icon name="arrow" size={18}/></button>}<div><small>{subtitle}</small><h2 id={id} ref={heading} tabIndex={-1}>{title}</h2></div><button className="gr-icon-button" type="button" onClick={dismiss} aria-label="Close and return to map"><Icon name="close" size={20}/></button></header>
    <div className="gr-sheet-scroll" ref={scroll}>{children}</div>
    {footer&&<footer className="gr-sheet-footer">{typeof footer==='function'?footer({dismiss}):footer}</footer>}
  </dialog>,document.body);
}
