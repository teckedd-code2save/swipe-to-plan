import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { fetch as expoFetch } from 'expo/fetch';
import { apiOrigin } from '../transport';
import {
  createDayDetailsApi, dayMapsUrl, dayRouteLegs, detailScopeKey, enquiryDraft,
  readinessData, venueDetailsData, venueMapsUrl, visitDetailsData,
} from '../day-details';
import { unfilledVisitMessage } from '../plan-flow';
import type { Plan, Stop } from '../types';

const colors = {paper:'#F7F5EF', surface:'#FFFDF8', ink:'#183B35', muted:'#5F6F66', celery:'#DCEABD', line:'#DDE3D8', error:'#9B392F'};
type Icon = React.ComponentProps<typeof Ionicons>['name'];
type ErrorHandler = (message: string) => void;
type Report = Awaited<ReturnType<ReturnType<typeof createDayDetailsApi>['load']>>;
const detailsApi = createDayDetailsApi({origin:apiOrigin(process.env.EXPO_PUBLIC_API_ORIGIN, __DEV__), fetch:expoFetch, development:__DEV__});

function Action({label, icon, onPress, disabled = false, quiet = false}: {label:string; icon?:Icon; onPress:() => void; disabled?:boolean; quiet?:boolean}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={({pressed}) => [styles.action, quiet && styles.quietAction, pressed && styles.pressed, disabled && styles.disabled]}>
    {!!icon && <Ionicons accessible={false} name={icon} size={20} color={colors.ink}/>}
    <Text style={styles.actionText}>{label}</Text>
  </Pressable>;
}
function Body({children, subtle = false}: {children:React.ReactNode; subtle?:boolean}) {return <Text style={[styles.body, subtle && styles.subtle]}>{children}</Text>;}
function Heading({children}: {children:React.ReactNode}) {return <Text accessibilityRole="header" style={styles.heading}>{children}</Text>;}
function Tags({values}: {values:string[]}) {return values.length ? <View style={styles.tags}>{values.map(value => <View style={styles.tag} key={value}><Text style={styles.tagText}>{value}</Text></View>)}</View> : null;}

function useOpenLink(onError?:ErrorHandler) {
  const [error, setError] = useState('');
  const opening = useRef(false);
  async function open(url:string | null) {
    if (!url || opening.current) return;
    // Every URL is constructed locally or returned by the shared contact validator.
    if (!/^https?:\/\//.test(url) && !/^tel:\+[1-9][0-9]{7,14}$/.test(url)) return;
    opening.current = true; setError('');
    try { await Linking.openURL(url); }
    catch {const message = 'This device could not open that link. Check the venue information and try again.'; setError(message); onError?.(message);}
    finally {opening.current = false;}
  }
  return {open, error};
}
function useVenueEvidence(plan:Plan, stop:Stop, onError?:ErrorHandler) {
  const key = detailScopeKey(plan, stop), currentKey = useRef(key);
  currentKey.current = key;
  const request = useRef<AbortController | null>(null);
  const [state, setState] = useState<{key:string; status:'idle'|'loading'|'ready'|'error'; report?:Report; error?:string}>({key, status:'idle'});
  useEffect(() => {return () => {request.current?.abort(); request.current = null;};}, [key]);
  const current = state.key === key ? state : {key, status:'idle' as const};
  async function refresh() {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setState({key, status:'loading'});
    try {
      const report = await detailsApi.load(plan, stop, controller.signal);
      if (!controller.signal.aborted && currentKey.current === key) setState({key, status:'ready', report});
    } catch (error) {
      if (!controller.signal.aborted && currentKey.current === key) {
        const message = error instanceof Error ? error.message : 'Venue details could not be checked.';
        setState({key, status:'error', error:message}); onError?.(message);
      }
    } finally {if (request.current === controller) request.current = null;}
  }
  return {...current, refresh};
}
function ErrorNote({message}: {message?:string}) {return message ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{message}</Text> : null;}

function Hours({place, evidence}: {place:ReturnType<typeof venueDetailsData>; evidence:ReturnType<typeof useVenueEvidence>}) {
  const report = evidence.report;
  const attention = place.reportedClosed || report?.hours.status === 'outside_reported_hours' || report?.hours.status === 'reported_closed';
  return <View style={[styles.section, attention && styles.attention]}>
    <Heading>{place.reportedClosed ? 'Reported closed' : report?.hours.label || 'Hours to confirm'}</Heading>
    <Body>{place.reportedClosed ? 'This venue is reported closed. Confirm directly or choose another place.' : report?.hours.summary || 'Check the reported weekly schedule before you head out.'}</Body>
    {!!report?.hours.intervals && <Body>{report.hours.intervals}</Body>}
    {place.hours.length > 0 && <View style={styles.hoursList}>{place.hours.map(row => <View key={row.day} style={styles.hoursRow}><Text style={styles.day}>{row.day}</Text><Text style={styles.hours}>{row.label}</Text></View>)}</View>}
    <Body subtle>Weekly hours can change for holidays or private events. They do not confirm kitchen hours, available seats or a reservation.</Body>
    {place.refreshable && <Action label={evidence.status === 'loading' ? 'Checking reported details…' : report ? 'Refresh reported hours & details' : 'Check reported hours & details'} icon="refresh-outline" onPress={evidence.refresh} disabled={evidence.status === 'loading'} quiet/>}
    {evidence.status === 'loading' && <ActivityIndicator accessibilityLabel="Checking venue details" color={colors.ink}/>}
    <ErrorNote message={evidence.error}/>
  </View>;
}
function Contact({place, open}: {place:ReturnType<typeof venueDetailsData>; open:(url:string | null) => void}) {
  if (place.conflicting) return <View style={styles.section}><Heading>Contact information needs checking</Heading><Body>Reported contact details do not match this venue. Verify them manually before reaching out.</Body></View>;
  return <View style={styles.section}>
    <Heading>Contact the venue</Heading>
    {place.phone ? <Text selectable style={styles.body}>Reported phone: {place.phone}</Text> : <Body subtle>No usable phone was supplied.</Body>}
    {place.phoneNeedsCountry && <Body subtle>Country context is missing. Verify this local number before dialing.</Body>}
    {place.websiteUrl && <Action label="Open venue website" icon="globe-outline" onPress={() => open(place.websiteUrl)} quiet/>}
    {place.dialUrl && <Action label={`Open dialer · ${place.phone}`} icon="call-outline" onPress={() => open(place.dialUrl)} quiet/>}
    {!place.websiteUrl && !place.phone && <Body subtle>No contact link has been guessed.</Body>}
    <Body subtle>Source: {place.contactSource}. Ownership and reachability are unverified. Opening a website or dialer does not confirm a booking. Nothing is sent by Unstressed.</Body>
  </View>;
}

/** Place inside the host sheet's ScrollView; deliberately does not own a modal. */
export function VenueDetails({stop, plan, onError}: {stop:Stop; plan:Plan; onError?:ErrorHandler}) {
  const evidence = useVenueEvidence(plan, stop, onError);
  const place = venueDetailsData(evidence.report?.place || stop.item);
  const visit = visitDetailsData(stop, plan);
  const {open, error} = useOpenLink(onError);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const key = detailScopeKey(plan, stop);
  if (!stop.item) return <Body>{unfilledVisitMessage(stop)}</Body>;
  return <View style={styles.root}>
    {place.imageUrl && failedImage !== place.imageUrl && <Image accessible accessibilityLabel={`Provider-reported photo for ${place.name}`} source={{uri:place.imageUrl}} style={styles.venueImage} resizeMode="cover" onError={() => setFailedImage(place.imageUrl)}/>}
    <Text style={styles.eyebrow}>{visit.time}</Text>
    {!!place.address && <Body subtle>{place.address}</Body>}
    {!!place.description && <Body>{place.description}</Body>}
    <Tags values={place.tags}/>
    <View style={styles.section}>
      <Heading>The food & the spend</Heading>
      <Text style={styles.emphasis}>{place.price}</Text><Body subtle>A reported relative price band, not a quote.</Body>
      {!!visit.allowance && <View style={styles.allowance}><Text style={styles.emphasis}>{visit.allowance}</Text><Body>Shared allowance for this stop</Body></View>}
      <Body subtle>Your allowance is a spending envelope. It is not evidence of what this venue will charge.</Body>
      {place.highlights.length > 0 && <><Text style={styles.label}>Provider-reported highlights</Text><Body>{place.highlights.join(' · ')}</Body><Body subtle>Dishes, prices and availability still need confirmation.</Body></>}
      {!!place.menuUrl && <Action label="Open reported menu" icon="restaurant-outline" onPress={() => open(place.menuUrl)} quiet/>}
    </View>
    <Hours place={place} evidence={evidence}/>
    {visit.experience.length > 0 && <View style={styles.section}><Heading>How it fits your request</Heading>{visit.experience.map(fit => <View key={fit.label} style={styles.detail}><Text style={styles.label}>{fit.label}</Text><Body subtle>{fit.detail}</Body></View>)}</View>}
    {visit.connections.length > 0 && <View style={styles.section}><Heading>The people behind this pick</Heading>{visit.connections.map(person => <View key={person.id} style={styles.detail}><Text style={styles.label}>{person.name}</Text>{person.evidence.map((edge, index) => <Body key={`${person.id}-${index}`}>{edge.label}</Body>)}</View>)}<Body subtle>These are cultural associations and discovery signals, not ratings or guarantees of individual preference.</Body></View>}
    {(place.practicalTags.length > 0 || place.childSuitability) && <View style={styles.section}><Heading>Reported features</Heading><Tags values={place.practicalTags}/>{place.childSuitability && <Body>The provider reports a family-friendly feature.</Body>}<Body subtle>Ask the venue about your specific dietary, accessibility and children’s needs. Reported features do not establish suitability.</Body></View>}
    <View style={styles.section}><Heading>Getting there</Heading>{!!visit.buffer && <Body>{visit.buffer}-minute planning buffer after this stop. This is not a measured travel time.</Body>}<Action label="View this venue in Maps" icon="map-outline" onPress={() => open(venueMapsUrl(stop))} disabled={!venueMapsUrl(stop)} quiet/><Body subtle>Maps opens only when you tap. Check the location and actual travel time before setting off.</Body></View>
    <Contact place={place} open={open}/>
    <View style={styles.section}>
      <Heading>Ask about a visit</Heading><Body>Prepare a short enquiry, then review it and contact the venue yourself. Confirm your date, local time, party size and any fees.</Body>
      <Action label={draftKey === key ? 'Hide enquiry draft' : 'Prepare enquiry draft'} icon="create-outline" onPress={() => setDraftKey(draftKey === key ? null : key)} quiet/>
      {draftKey === key && <View style={styles.draft}><Text style={styles.label}>Draft only · not sent</Text><Text selectable style={styles.body}>{enquiryDraft(plan, stop)}</Text><Body subtle>Press and hold to select text. No message has been sent and no booking has been made.</Body></View>}
    </View>
    <Body subtle>{place.source}. Provider update time is unknown.</Body><ErrorNote message={error}/>
  </View>;
}
function ReadyStop({stop, plan, onError, onOpenStop}: {stop:Stop; plan:Plan; onError?:ErrorHandler; onOpenStop?:(stop:Stop) => void}) {
  const evidence = useVenueEvidence(plan, stop, onError);
  const place = venueDetailsData(evidence.report?.place || stop.item), visit = visitDetailsData(stop, plan);
  const {open, error} = useOpenLink(onError);
  if (!stop.item) return <View style={styles.card}><Heading>A stop still to find</Heading><Body>{unfilledVisitMessage(stop)}</Body></View>;
  return <View style={styles.card}>
    <Text style={styles.eyebrow}>{visit.time}</Text><Heading>{place.name}</Heading>
    {!!visit.allowance && <Body>{visit.allowance} shared allowance · not a quote</Body>}
    <Hours place={place} evidence={evidence}/>
    <View style={styles.detail}><Text style={styles.label}>Prices & availability</Text><Body>{place.price}. Confirm the menu, availability, deposits and cancellation terms directly.</Body></View>
    {!!place.menuUrl && <Action label="Open reported menu" icon="restaurant-outline" onPress={() => open(place.menuUrl)} quiet/>}
    {onOpenStop ? <Action label="Venue details & enquiry" icon="arrow-forward-outline" onPress={() => onOpenStop(stop)} quiet/> : <Contact place={place} open={open}/>}
    <ErrorNote message={error}/>
  </View>;
}
/** Place inside the day screen's ScrollView. No checks run until a deliberate tap. */
export function DayReadiness({plan, onError, onOpenStop, onEditTiming}: {plan:Plan; onError?:ErrorHandler; onOpenStop?:(stop:Stop) => void; onEditTiming?:() => void}) {
  const data = readinessData(plan), {open, error} = useOpenLink(onError);
  const [mode, setMode] = useState('driving'); const route = dayMapsUrl(plan, mode); const legs = dayRouteLegs(plan, mode);
  return <View style={styles.root}>
    <View style={styles.intro}><Text style={styles.eyebrow}>A LITTLE PREPARATION</Text><Heading>Before you head out</Heading><Body>{data.date}{data.timeZone ? ` · ${data.timeZone}` : ''}</Body><Body subtle>This is a suggested outing. Check the details below and confirm reservations directly with each venue.</Body></View>
    {(!plan.request.timing.dateConfirmed || !plan.request.timing.timeConfirmed) && <View style={styles.card}><Heading>When are you heading out?</Heading><Body subtle>Your time is still flexible. Choose a date and time to check how the places fit.</Body>{!!onEditTiming && <Action label="Choose a date and time" icon="time-outline" onPress={onEditTiming}/>}</View>}
    <View style={styles.card}><Heading>A little room in the budget</Heading><Text style={styles.emphasis}>{data.total || 'Budget not set'}</Text>{!!data.total && <Body subtle>{data.suggested ? 'Suggested outing allowance' : 'Your whole-outing allowance'}. Not a venue quote.</Body>}{!!data.transport && <Body>Getting around: {data.transport}</Body>}{!!data.reserve && <Body>Breathing room: {data.reserve}</Body>}{!!data.note && <Body subtle>{data.note}</Body>}</View>
    {plan.stops.map(stop => <ReadyStop key={`${stop.id}-${stop.item?.id || 'empty'}`} stop={stop} plan={plan} onError={onError} onOpenStop={onOpenStop}/>)}
    <View style={styles.card}><Heading>Check the route</Heading><Body>The route follows your selected places in order. It does not use your current location.</Body><View style={styles.modes}>{[['driving','Drive'], ['walking','Walk'], ['transit','Transit']].map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{selected:mode === value}} onPress={() => setMode(value)} style={[styles.mode, mode === value && styles.selectedMode]}><Text style={styles.actionText}>{label}</Text></Pressable>)}</View>{mode === 'transit' && legs.length > 1 ? <><Body subtle>Transit directions open one leg at a time so no stop is skipped.</Body>{legs.map(leg => <Action key={leg.id} label={leg.label} icon="train-outline" onPress={() => open(leg.url)}/>)}</> : <Action label="Open route in Google Maps" icon="map-outline" onPress={() => open(route)} disabled={!route}/>}<Body subtle>Maps provides the route after you open it. No travel duration, fare or transport booking is confirmed here.</Body></View>
    {(data.warnings.length > 0 || data.timingNotes.length > 0) && <View style={styles.card}><Heading>A few things to keep in mind</Heading>{[...new Set([...data.timingNotes, ...data.warnings])].map((note, index) => <Body key={index}>{note}</Body>)}</View>}
    <ErrorNote message={error}/>
  </View>;
}
const styles = StyleSheet.create({
  venueImage:{width:'100%', aspectRatio:1.55, borderRadius:18, backgroundColor:colors.paper},
  root:{gap:18}, intro:{gap:10, paddingVertical:4},
  card:{padding:18, gap:12, borderRadius:22, borderWidth:1, borderColor:colors.line, backgroundColor:colors.surface},
  section:{gap:10, paddingTop:16, borderTopWidth:1, borderTopColor:colors.line},
  detail:{gap:6}, heading:{fontFamily:'Manrope_700Bold', fontSize:20, lineHeight:28, color:colors.ink},
  body:{fontFamily:'Manrope_400Regular', fontSize:15, lineHeight:23, color:colors.ink, flexShrink:1},
  subtle:{color:colors.muted, fontSize:13, lineHeight:21}, label:{fontFamily:'Manrope_600SemiBold', fontSize:14, lineHeight:22, color:colors.ink},
  emphasis:{fontFamily:'Manrope_700Bold', fontSize:21, lineHeight:30, color:colors.ink}, eyebrow:{fontFamily:'Manrope_700Bold', fontSize:11, lineHeight:18, letterSpacing:1.1, color:colors.muted},
  action:{minHeight:48, paddingVertical:13, paddingHorizontal:15, borderRadius:15, backgroundColor:colors.celery, gap:10, flexDirection:'row', alignItems:'center'}, quietAction:{backgroundColor:colors.paper, borderWidth:1, borderColor:colors.line},
  actionText:{fontFamily:'Manrope_600SemiBold', fontSize:14, lineHeight:22, color:colors.ink, flexShrink:1}, pressed:{opacity:0.7}, disabled:{opacity:0.45},
  tags:{flexDirection:'row', flexWrap:'wrap', gap:7}, tag:{paddingVertical:7, paddingHorizontal:11, backgroundColor:colors.paper, borderRadius:12, maxWidth:'100%'}, tagText:{fontFamily:'Manrope_500Medium', fontSize:12, lineHeight:19, color:colors.muted},
  allowance:{backgroundColor:colors.paper, borderRadius:14, padding:13, gap:4}, hoursList:{gap:9, paddingVertical:4}, hoursRow:{flexDirection:'row', flexWrap:'wrap', gap:5},
  day:{fontFamily:'Manrope_600SemiBold', color:colors.ink, fontSize:13, lineHeight:21, flexBasis:105, flexGrow:1}, hours:{fontFamily:'Manrope_400Regular', color:colors.muted, fontSize:13, lineHeight:21, flexBasis:160, flexGrow:2},
  attention:{borderTopColor:colors.error}, error:{fontFamily:'Manrope_500Medium', color:colors.error, fontSize:14, lineHeight:22}, draft:{backgroundColor:colors.paper, padding:16, borderRadius:16, gap:12},
  modes:{flexDirection:'row', flexWrap:'wrap', gap:8}, mode:{minHeight:48, minWidth:80, flexGrow:1, alignItems:'center', justifyContent:'center', padding:12, borderRadius:14, borderWidth:1, borderColor:colors.line}, selectedMode:{backgroundColor:colors.celery, borderColor:colors.celery},
});
