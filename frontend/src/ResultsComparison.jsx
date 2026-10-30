import {useEffect,useRef,useState} from 'react';
import {useQueries} from '@tanstack/react-query';
import {Button,Card,Flex,Text} from '@radix-ui/themes';
import {api} from './api.js';
import {decisionStops} from './decision-evidence.js';

// A short, evidence-grounded comparison is prepared alongside the results.
export default function ResultsComparison({plan,checks,busy,onCompare,onReady,chat=[]}){
  const shown=decisionStops(plan).slice(0,4),compareRef=useRef(onCompare);
  compareRef.current=onCompare;
  const readyRef=useRef(onReady);readyRef.current=onReady;
  const [comparison,setComparison]=useState({status:'waiting',text:''}),[retry,setRetry]=useState(0);
  const queries=useQueries({queries:shown.map(stop=>({queryKey:['venue',stop.item.entityId],queryFn:({signal})=>api.place(stop.item.entityId,AbortSignal.any([signal,AbortSignal.timeout(12000)])),enabled:!!stop.item.entityId&&!busy,staleTime:300000,retry:1,refetchOnWindowFocus:false,initialData:checks?.data?.stops.find(s=>s.entityId===stop.item.entityId)?.place}))});
  const menus=useQueries({queries:shown.map((stop,i)=>({queryKey:['menu-evidence',stop.item.entityId],queryFn:({signal})=>api.menuEvidence(stop.item.entityId,AbortSignal.any([signal,AbortSignal.timeout(25000)])),enabled:!!stop.item.entityId&&!busy&&!!(queries[i]?.data?.links?.menu||queries[i]?.data?.links?.website),staleTime:900000,retry:false,refetchOnWindowFocus:false}))});
  const waiting=busy||checks?.status==='loading'||shown.some((stop,i)=>stop.item.entityId&&(queries[i]?.isPending||queries[i]?.isFetching||((queries[i]?.data?.links?.menu||queries[i]?.data?.links?.website)&&(menus[i]?.isPending||menus[i]?.isFetching))));
  const key=JSON.stringify([shown.map(stop=>stop.item.id),plan.request.area,plan.request.date,plan.request.timing,plan.request.budget,plan.request.currency,plan.request.people,plan.request.experience,plan.request.route]);
  const already=chat.some(turn=>turn.comparisonKey===key);
  useEffect(()=>{
    if(shown.length<2||waiting||already)return;
    const controller=new AbortController();setComparison({status:'loading',text:''});
    compareRef.current(shown.map(stop=>stop.item.id),[],controller.signal).then(text=>{if(!controller.signal.aborted){setComparison({status:'ready',text});readyRef.current(text,key);}}).catch(()=>{if(!controller.signal.aborted)setComparison({status:'error',text:''});});
    return()=>controller.abort();
  },[key,waiting,retry,already]);
  if(shown.length<2||already||comparison.status==='ready')return null;
  return <Card size="2" variant="soft" aria-label="Comparing your places"><Flex align="center" gap="3"><Text as="p" size="2" role="status">{comparison.status==='error'?'I couldn’t finish comparing these places.':waiting?'Checking available details…':'Comparing these places for your outing…'}</Text>{comparison.status==='error'&&<Button size="1" variant="soft" onClick={()=>setRetry(value=>value+1)}>Try again</Button>}</Flex></Card>;
}
