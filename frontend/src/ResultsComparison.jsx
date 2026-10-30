import {useEffect,useRef,useState} from 'react';
import {useQueries} from '@tanstack/react-query';
import {Button,Card,Flex,Heading,Text} from '@radix-ui/themes';
import AgentReply from './AgentReply.jsx';
import {api} from './api.js';
import {decisionStops} from './decision-evidence.js';

// A short, evidence-grounded comparison is prepared alongside the results.
export default function ResultsComparison({plan,checks,busy,onCompare,onDetails}){
  const shown=decisionStops(plan).slice(0,4),compareRef=useRef(onCompare);
  compareRef.current=onCompare;
  const [comparison,setComparison]=useState({status:'waiting',text:''}),[retry,setRetry]=useState(0);
  const queries=useQueries({queries:shown.map(stop=>({queryKey:['venue',stop.item.entityId],queryFn:({signal})=>api.place(stop.item.entityId,AbortSignal.any([signal,AbortSignal.timeout(12000)])),enabled:!!stop.item.entityId&&!busy,staleTime:300000,retry:1,refetchOnWindowFocus:false,initialData:checks?.data?.stops.find(s=>s.entityId===stop.item.entityId)?.place}))});
  const menus=useQueries({queries:shown.map((stop,i)=>({queryKey:['menu-evidence',stop.item.entityId],queryFn:({signal})=>api.menuEvidence(stop.item.entityId,AbortSignal.any([signal,AbortSignal.timeout(25000)])),enabled:!!stop.item.entityId&&!busy&&!!(queries[i]?.data?.links?.menu||queries[i]?.data?.links?.website),staleTime:900000,retry:false,refetchOnWindowFocus:false}))});
  const waiting=busy||checks?.status==='loading'||shown.some((stop,i)=>stop.item.entityId&&(queries[i]?.isPending||queries[i]?.isFetching||((queries[i]?.data?.links?.menu||queries[i]?.data?.links?.website)&&(menus[i]?.isPending||menus[i]?.isFetching))));
  const key=JSON.stringify([shown.map(stop=>stop.item.id),plan.request.date,plan.request.timing,plan.request.budget,plan.request.experience,plan.request.route]);
  useEffect(()=>{
    if(shown.length<2||waiting)return;
    const controller=new AbortController();setComparison({status:'loading',text:''});
    compareRef.current(shown.map(stop=>stop.item.id),[],controller.signal).then(text=>{if(!controller.signal.aborted)setComparison({status:'ready',text});}).catch(()=>{if(!controller.signal.aborted)setComparison({status:'error',text:''});});
    return()=>controller.abort();
  },[key,waiting,retry]);
  if(shown.length<2)return null;
  return <Card size="3" variant="soft" mb="4" aria-label="How these places compare"><Flex direction="column" gap="2"><Heading as="h3" size="3">Let’s find your best fit</Heading>{comparison.status==='ready'?<AgentReply text={comparison.text} stops={shown} onPlace={onDetails}/>:comparison.status==='error'?<><Text as="p" size="2" role="status">I couldn’t finish comparing these places. You can still explore their details below.</Text><Flex><Button size="2" variant="soft" onClick={()=>setRetry(value=>value+1)}>Try again</Button></Flex></>:<Text as="p" size="2" role="status">{waiting?'Checking available details…':'Comparing these places for your outing…'}</Text>}</Flex></Card>;
}
