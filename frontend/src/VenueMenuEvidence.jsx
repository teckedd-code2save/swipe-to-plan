import {menuHighlights} from './menu-highlights.js';
import {useQuery} from '@tanstack/react-query';
import {Badge,Button,Heading,Text,Flex} from '@radix-ui/themes';
import {api} from './api.js';
import {displayMenuPrice} from './menu-prices.js';
export default function VenueMenuEvidence({place}) {
 const query=useQuery({queryKey:['menu-evidence',place.entityId],queryFn:({signal})=>api.menuEvidence(place.entityId,AbortSignal.any([signal,AbortSignal.timeout(25000)])),enabled:!!place.entityId&&!!(place.links?.menu||place.links?.website),staleTime:900000,retry:false,refetchOnWindowFocus:false});
 const prices=query.data?.items||[],highlights=menuHighlights(place.highlights||[]);
 return <section className="pg-detail-section venue-menu-evidence"><Heading size="4" as="h3">{prices.length?'Published menu prices':'Menu & prices'}</Heading>
 {query.isFetching&&<Text as="p" size="2" role="status">Checking the venue-linked page for prices…</Text>}
 {prices.length?<><Badge color="green">Source-linked prices</Badge><dl className="venue-price-list">{prices.slice(0,10).map(item=><div key={item.id}><dt>{item.name}</dt><dd>{displayMenuPrice(item)}</dd></div>)}</dl>{prices.length>10&&<details><summary>{prices.length-10} more items</summary><dl className="venue-price-list">{prices.slice(10).map(item=><div key={item.id}><dt>{item.name}</dt><dd>{displayMenuPrice(item)}</dd></div>)}</dl></details>}<Text as="p" size="2">Read {new Date(query.data.checkedAt).toLocaleDateString()}. Published prices may change; portions, extras and availability need confirmation.</Text></>:<>{highlights.length?<><Text as="p" size="2" color="gray">Reported dishes · prices not supplied</Text><ul className="venue-dish-list">{highlights.map(item=><li key={item.key}>{item.label}</li>)}</ul></>:<Text as="p" size="2">No menu items supplied by the venue data.</Text>}{!query.isFetching&&<Text as="p" size="2" color="gray">Current prices and availability still need confirmation.</Text>}</>}
 <Flex gap="2" wrap="wrap">{(query.data?.sourceUrl||place.links?.menu||place.links?.website)&&<Button asChild variant="soft"><a href={query.data?.sourceUrl||place.links.menu||place.links.website} target="_blank" rel="noreferrer">{prices.length?'View price source':'Open venue menu or website'} ↗</a></Button>}{place.links?.phone&&<Button asChild variant="outline"><a href={place.links.phone}>Call to confirm menu & prices</a></Button>}{(query.isError||query.data?.status==='unavailable')&&<Button variant="soft" onClick={()=>query.refetch()}>Retry menu lookup</Button>}</Flex>
 </section>;
}
