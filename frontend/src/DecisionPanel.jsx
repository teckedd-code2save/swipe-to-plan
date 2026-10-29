import {displayMenuPrice,selectedMenuTotal,pricedMenuSelections} from './menu-prices.js';
import {useState,useEffect,useRef} from 'react';
import AgentReply from './AgentReply.jsx';
import {useQueries} from '@tanstack/react-query';
import {Badge,Button,Card,Flex,Heading,IconButton,Text,CheckboxCards} from '@radix-ui/themes';
import {api} from './api.js';
import {Icon} from './PlannerIcons.jsx';
import {menuHighlights} from './menu-highlights.js';
import {decisionStops,reportedPrice,reportedHours,spendingSummary} from './decision-evidence.js';
import {formatMoney} from './money.js';
import {routeLink} from './route-links.js';
import './decision-panel.css';

export default function DecisionPanel({plan,checks,onDone,onDetails,onTool,selected=[],onSelectionChange,onAskAgent,mode='compare'}) {
  const stops=decisionStops(plan),[visible,setVisible]=useState(4);
  const shown=stops.slice(0,visible);
  const queries=useQueries({queries:shown.map(stop=>({queryKey:['venue',stop.item.entityId],queryFn:({signal})=>api.place(stop.item.entityId,AbortSignal.any([signal,AbortSignal.timeout(12000)])),enabled:!!stop.item.entityId,staleTime:300000,retry:1,refetchOnWindowFocus:false,initialData:checks?.data?.stops.find(s=>s.entityId===stop.item.entityId)?.place}))});
  const menus=useQueries({queries:shown.map((stop,index)=>({queryKey:['menu-evidence',stop.item.entityId],queryFn:({signal})=>api.menuEvidence(stop.item.entityId,AbortSignal.any([signal,AbortSignal.timeout(25000)])),enabled:!!stop.item.entityId&&!!(queries[index]?.data?.links?.menu||queries[index]?.data?.links?.website),staleTime:900000,retry:false,refetchOnWindowFocus:false}))});
  const enriched=pricedMenuSelections(selected,new Map(shown.map((stop,i)=>[stop.item.id,menus[i]?.data])));
  const enrichedKey=JSON.stringify(enriched);
  useEffect(()=>{if(onSelectionChange&&enrichedKey!==JSON.stringify(selected))onSelectionChange(enriched);},[enrichedKey]);
  const spend=plan?spendingSummary(plan):null;
  const subtotal=selectedMenuTotal(selected,spend?.currency);
  const [comparison,setComparison]=useState({status:'waiting',text:''}),[retry,setRetry]=useState(0);
  const compareRef=useRef(onAskAgent);compareRef.current=onAskAgent;
  const waiting=shown.some((stop,i)=>stop.item.entityId&&((queries[i]?.isPending||queries[i]?.isFetching)||((queries[i]?.data?.links?.menu||queries[i]?.data?.links?.website)&&(menus[i]?.isPending||menus[i]?.isFetching))));
  const comparisonKey=JSON.stringify([shown.map(stop=>stop.item.id),enriched]);
  useEffect(()=>{
    if(mode!=='menus'||!shown.length||waiting||!compareRef.current)return;
    const controller=new AbortController();setComparison({status:'loading',text:''});
    compareRef.current(shown.map(stop=>stop.item.id),enriched,controller.signal).then(text=>{if(!controller.signal.aborted)setComparison({status:'ready',text});}).catch(error=>{if(!controller.signal.aborted)setComparison({status:'error',text:error.message});});
    return()=>controller.abort();
  },[mode,comparisonKey,waiting,retry]);
  return <section className="decision-panel" aria-label={mode==='menus'?'Menus and prices':'Compare places'}>
    <Flex justify="between" align="center" gap="3"><Heading size="5">{mode==='menus'?'Food, drinks & prices':'Find your best fit'}</Heading><IconButton variant="ghost" aria-label="Close comparison" onClick={onDone}><Icon name="close" size={18}/></IconButton></Flex>
    {mode==='menus'&&<Card size="3" variant="soft" mt="4"><Flex direction="column" gap="3"><Heading size="3" as="h3">Let’s find your best fit</Heading>{comparison.status==='ready'?<AgentReply text={comparison.text} stops={shown} onPlace={onDetails}/>:comparison.status==='error'?<><Text as="p" size="2" role="alert">I couldn’t finish comparing these places. Their available details are below.</Text><Flex><Button type="button" size="2" variant="soft" onClick={()=>setRetry(value=>value+1)}>Try comparison again</Button></Flex></>:<Text as="p" size="2" role="status">{waiting?'Gathering menus, prices and hours…':'Comparing the places for your outing…'}</Text>}</Flex></Card>}
    {spend&&<Flex className="decision-budget" align="center" justify="between" wrap="wrap" gap="3"><div><Badge color={spend.suggested?'amber':'green'}>{spend.suggested?'Suggested spending':'Your spending limit'}</Badge><Text as="p" size="4" weight="bold">{spend.amount!=null?formatMoney(spend.amount,spend.currency):'No amount set'}{spend.people>1?' total':' for you'}</Text><Text as="p" size="2" color="gray">{spend.suggested?'A planning suggestion, not venue prices.':'For the whole outing, including travel.'}</Text></div>{onTool&&<Button variant="soft" onClick={()=>onTool('budget')}>Edit spending</Button>}</Flex>}
    {!shown.length&&<Text as="p">Places will appear here when your search returns.</Text>}
    <div className="decision-grid">{shown.map((stop,index)=>{
      const query=queries[index],place=query.data||stop.item,report=checks?.data?.stops.find(s=>s.entityId===stop.item.entityId),highlights=menuHighlights(place.highlights||report?.menu?.highlights||[]),hours=reportedHours(place),current=plan.stops.some(s=>s.item?.id===stop.item.id);
      const menu=menus[index],prices=menu?.data?.items||[];
      const choices=prices.length?prices.map(p=>({...p,key:`${p.name.toLocaleLowerCase()}|${p.currency}|${p.price}`,label:p.name})):highlights;
      const picks=selected.filter(s=>s.placeId===stop.item.id).map(s=>s.menuKey||s.label.toLocaleLowerCase());
      const links=place.links||{};
      return <Card key={stop.item.id} className="decision-card" size="3">
        {place.image&&<img className="decision-photo" src={place.image} alt="" loading="lazy" onError={e=>{e.currentTarget.style.display='none';}}/>}
        <Flex gap="2" wrap="wrap"><Badge color={current?'green':'gray'}>{current?'In your outing':'Another option'}</Badge><Badge color="gray">{prices.length?'Menu prices available':reportedPrice(place)}</Badge></Flex>
        <Heading size="4" as="h3" mt="3">{place.name}</Heading><Text as="p" size="2" color="gray">{place.address}</Text>
        {query.isFetching&&<Text as="p" size="2" role="status">Loading venue details…</Text>}
        {query.isError&&<Flex align="center" gap="2"><Text size="2">Details couldn’t load. Existing information is still shown.</Text><Button size="1" variant="soft" onClick={()=>query.refetch()}>Retry</Button></Flex>}
        <section><Heading size="2" as="h4">{prices.length?'Published menu prices':'Menu highlights'}</Heading>{choices.length?(mode==='menus'&&onSelectionChange?<CheckboxCards.Root size="1" value={picks} onValueChange={values=>onSelectionChange([...selected.filter(s=>s.placeId!==stop.item.id),...choices.filter(h=>values.includes(h.key)).map(h=>({id:`${stop.item.id}:${h.key}`,menuKey:h.key,label:h.label,venue:place.name,intent:stop.intent,placeId:stop.item.id,...(h.price?{price:h.price,currency:h.currency,sourceUrl:h.sourceUrl}:{} )}))])}>{choices.map(h=><CheckboxCards.Item value={h.key} key={`${h.key}:${h.price||0}`}><span>{h.label}{h.price&&<strong className="menu-published-price">{displayMenuPrice(h)}</strong>}</span></CheckboxCards.Item>)}</CheckboxCards.Root>:<Text as="p" size="2">{choices.map(h=>h.price?`${h.label} · ${displayMenuPrice(h)}`:h.label).join(' · ')}</Text>):<Text as="p" size="2" color="gray">No dishes supplied by the venue data.</Text>}
          <Text as="p" size="2" className="decision-price-note">{menu?.isFetching?'Checking the venue-linked page for published prices…':prices.length?'Published prices, not a live quote. Portions, extras and availability need confirmation.':'No readable item prices found. The venue’s menu or contact details are below.'}</Text>
          {(menu?.isError||menu?.data?.status==='unavailable')&&<Button size="1" variant="soft" onClick={()=>menu.refetch()}>Retry menu lookup</Button>}
          <Flex gap="2" wrap="wrap">{prices.length>0&&<Text size="1" color="gray">Read {new Date(menu.data.checkedAt).toLocaleDateString()}</Text>}{prices.length>0&&<Button asChild size="2" variant="soft"><a href={menu.data.sourceUrl} target="_blank" rel="noreferrer">Price source ↗</a></Button>}{links.menu?<Button asChild size="2" variant="soft"><a href={links.menu} target="_blank" rel="noreferrer">View menu & prices ↗</a></Button>:links.website?<Button asChild size="2" variant="soft"><a href={links.website} target="_blank" rel="noreferrer">Check venue website ↗</a></Button>:null}{links.phone&&<Button asChild size="2" variant="outline"><a href={links.phone}>Call for prices</a></Button>}</Flex>
        </section>
        <section><Heading size="2" as="h4">Opening hours</Heading>{report?.hours?.status==='fits_reported_hours'&&<Text as="p" size="2">{report.hours.summary}</Text>}{typeof hours==='string'?<Text color="red">{hours}</Text>:hours.length?<dl className="decision-hours">{hours.map(row=><div key={row.day}><dt>{row.day}</dt><dd>{row.label}</dd></div>)}</dl>:<Text as="p" size="2" color="gray">Hours haven’t been supplied.</Text>}</section>
        <Flex gap="2" wrap="wrap"><Button asChild variant="soft"><a href={routeLink({stop},'driving')} target="_blank" rel="noreferrer">Directions ↗</a></Button><Button variant="outline" onClick={()=>onDetails(stop)}>Full details</Button></Flex>
        <Text as="p" size="1" color="gray" mt="3">Qloo venue data · current prices and opening hours need venue confirmation.</Text>
      </Card>;
    })}</div>
    {stops.length>visible&&<Button variant="soft" onClick={()=>setVisible(v=>v+4)}>Compare more places ({stops.length-visible})</Button>}
    {mode==='menus'&&subtotal.priced>0&&<div className="decision-budget" role="status"><strong>Selected items: {spend.currency} {subtotal.amount.toFixed(2)}</strong><Text as="p" size="2">One of each priced selection. {subtotal.unpriced?`${subtotal.unpriced} selections have no comparable price. `:''}Excludes travel, fees, extras and additional portions.{spend.amount!=null?` ${subtotal.amount>spend.amount?'Already above':'Compared with'} your ${spend.suggested?'suggested spending':'outing limit'} of ${formatMoney(spend.amount,spend.currency)}.`:''}</Text></div>}
    {mode==='menus'&&selected.length>0&&<Text as="p" size="2" role="status">{selected.length} menu preferences saved to your outing. No order placed.</Text>}
  </section>;
}
