import {useState} from 'react';
import {useQueries} from '@tanstack/react-query';
import {Badge,Button,Card,Flex,Heading,IconButton,Text,CheckboxCards} from '@radix-ui/themes';
import {api} from './api.js';
import {Icon} from './PlannerIcons.jsx';
import {menuHighlights} from './menu-highlights.js';
import {decisionStops,reportedPrice,reportedHours,spendingSummary} from './decision-evidence.js';
import {formatMoney} from './money.js';
import {routeLink} from './route-links.js';
import './decision-panel.css';

export default function DecisionPanel({plan,checks,onDone,onDetails,onTool,selected=[],onSelectionChange,mode='compare'}) {
  const stops=decisionStops(plan),[visible,setVisible]=useState(4);
  const shown=stops.slice(0,visible);
  const queries=useQueries({queries:shown.map(stop=>({queryKey:['venue',stop.item.entityId],queryFn:({signal})=>api.place(stop.item.entityId,AbortSignal.any([signal,AbortSignal.timeout(12000)])),enabled:!!stop.item.entityId,staleTime:300000,retry:1,refetchOnWindowFocus:false,initialData:checks?.data?.stops.find(s=>s.entityId===stop.item.entityId)?.place}))});
  const spend=plan?spendingSummary(plan):null;
  return <section className="decision-panel" aria-label={mode==='menus'?'Menus and prices':'Compare places'}>
    <Flex justify="between" align="center" gap="3"><Heading size="5">{mode==='menus'?'Food, drinks & prices':'Find your best fit'}</Heading><IconButton variant="ghost" aria-label="Close comparison" onClick={onDone}><Icon name="close" size={18}/></IconButton></Flex>
    {spend&&<Flex className="decision-budget" align="center" justify="between" wrap="wrap" gap="3"><div><Badge color={spend.suggested?'amber':'green'}>{spend.suggested?'Suggested spending':'Your spending limit'}</Badge><Text as="p" size="4" weight="bold">{spend.amount!=null?formatMoney(spend.amount,spend.currency):'No amount set'}{spend.people>1?' total':' for you'}</Text><Text as="p" size="2" color="gray">{spend.suggested?'A planning suggestion, not venue prices.':'For the whole outing, including travel.'}</Text></div>{onTool&&<Button variant="soft" onClick={()=>onTool('budget')}>Edit spending</Button>}</Flex>}
    {!shown.length&&<Text as="p">Places will appear here when your search returns.</Text>}
    <div className="decision-grid">{shown.map((stop,index)=>{
      const query=queries[index],place=query.data||stop.item,report=checks?.data?.stops.find(s=>s.entityId===stop.item.entityId),highlights=menuHighlights(place.highlights||report?.menu?.highlights||[]),hours=reportedHours(place),current=plan.stops.some(s=>s.item?.id===stop.item.id);
      const picks=selected.filter(s=>s.placeId===stop.item.id).map(s=>s.label.toLocaleLowerCase());
      const links=place.links||{};
      return <Card key={stop.item.id} className="decision-card" size="3">
        {place.image&&<img className="decision-photo" src={place.image} alt="" loading="lazy" onError={e=>{e.currentTarget.style.display='none';}}/>}
        <Flex gap="2" wrap="wrap"><Badge color={current?'green':'gray'}>{current?'In your outing':'Another option'}</Badge><Badge color="gray">{reportedPrice(place)}</Badge></Flex>
        <Heading size="4" as="h3" mt="3">{place.name}</Heading><Text as="p" size="2" color="gray">{place.address}</Text>
        {query.isFetching&&<Text as="p" size="2" role="status">Loading venue details…</Text>}
        {query.isError&&<Flex align="center" gap="2"><Text size="2">Details couldn’t load. Existing information is still shown.</Text><Button size="1" variant="soft" onClick={()=>query.refetch()}>Retry</Button></Flex>}
        <section><Heading size="2" as="h4">Menu highlights</Heading>{highlights.length?(mode==='menus'&&onSelectionChange?<CheckboxCards.Root size="1" value={picks} onValueChange={values=>onSelectionChange([...selected.filter(s=>s.placeId!==stop.item.id),...highlights.filter(h=>values.includes(h.key)).map(h=>({id:`${stop.item.id}:${h.key}`,label:h.label,venue:place.name,intent:stop.intent,placeId:stop.item.id}))])}>{highlights.map(h=><CheckboxCards.Item value={h.key} key={h.key}>{h.label}</CheckboxCards.Item>)}</CheckboxCards.Root>:<Text as="p" size="2">{highlights.map(h=>h.label).join(' · ')}</Text>):<Text as="p" size="2" color="gray">No dishes supplied by the venue data.</Text>}
          <Text as="p" size="2" className="decision-price-note">Item prices aren’t available, so a bill or price saving cannot be calculated yet.</Text>
          <Flex gap="2" wrap="wrap">{links.menu?<Button asChild size="2" variant="soft"><a href={links.menu} target="_blank" rel="noreferrer">View menu & prices ↗</a></Button>:links.website?<Button asChild size="2" variant="soft"><a href={links.website} target="_blank" rel="noreferrer">Check venue website ↗</a></Button>:null}{links.phone&&<Button asChild size="2" variant="outline"><a href={links.phone}>Call for prices</a></Button>}</Flex>
        </section>
        <section><Heading size="2" as="h4">Opening hours</Heading>{report?.hours?.status==='fits_reported_hours'&&<Text as="p" size="2">{report.hours.summary}</Text>}{typeof hours==='string'?<Text color="red">{hours}</Text>:hours.length?<dl className="decision-hours">{hours.map(row=><div key={row.day}><dt>{row.day}</dt><dd>{row.label}</dd></div>)}</dl>:<Text as="p" size="2" color="gray">Hours haven’t been supplied.</Text>}</section>
        <Flex gap="2" wrap="wrap"><Button asChild variant="soft"><a href={routeLink({stop},'driving')} target="_blank" rel="noreferrer">Directions ↗</a></Button><Button variant="outline" onClick={()=>onDetails(stop)}>Full details</Button></Flex>
        <Text as="p" size="1" color="gray" mt="3">Qloo venue data · current prices and opening hours need venue confirmation.</Text>
      </Card>;
    })}</div>
    {stops.length>visible&&<Button variant="soft" onClick={()=>setVisible(v=>v+4)}>Compare more places ({stops.length-visible})</Button>}
    {mode==='menus'&&selected.length>0&&<Text as="p" size="2" role="status">{selected.length} menu preferences saved to your outing. No order placed.</Text>}
  </section>;
}
