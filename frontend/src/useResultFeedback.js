import {useEffect,useRef,useState} from 'react';

// Only settled results announce. Streaming previews, metadata saves and check
// completions do not produce another toast. An explicit refresh still counts
// when it returns the same places. Nothing here changes navigation or focus.
export default function useResultFeedback({scope,resultKey,revision,busy,failed,planOpen,label}) {
  const last=useRef({scope,key:'',revision});
  const wasBusy=useRef(busy);
  const serial=useRef(0);
  const [state,setState]=useState({scope,unseen:false,feedback:null});
  useEffect(()=>{
    const finishing=wasBusy.current&&!busy;
    wasBusy.current=busy;
    if(last.current.scope!==scope){
      // Saving a freshly generated outing can assign its identity in the same
      // render as completion. Do not consume that completion as old history.
      const completed=finishing&&revision>last.current.revision;
      last.current={scope,key:busy||completed?'':resultKey,revision};
      setState({scope,unseen:false,feedback:null});
      if(!completed)return;
    }
    if(!resultKey){last.current={scope,key:'',revision};setState({scope,unseen:false,feedback:null});return;}
    if(busy||failed){setState(value=>value.feedback?{...value,feedback:null}:value);return;}
    if(last.current.key===resultKey&&last.current.revision===revision)return;
    const updated=!!last.current.key;
    last.current={scope,key:resultKey,revision};
    setState({scope,unseen:!planOpen,feedback:{id:++serial.current,text:updated?`Results updated. ${label}.`:`${label}.`}});
  },[scope,resultKey,revision,busy,failed,planOpen,label]);
  useEffect(()=>{if(planOpen)setState(value=>value.unseen?{...value,unseen:false}:value);},[planOpen]);
  useEffect(()=>{
    if(!state.feedback)return;
    const timer=setTimeout(()=>setState(value=>({...value,feedback:null})),5000);
    return()=>clearTimeout(timer);
  },[state.feedback]);
  return state.scope===scope?state:{scope,unseen:false,feedback:null};
}
