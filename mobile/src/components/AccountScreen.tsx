import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { connectedPeople } from '../account-session';
import type { Person, Plan } from '../types';

type Session = {
  getSnapshot: () => { signedIn: boolean; signingIn: boolean; userCode?: string | null; signInStatus?: string | null; userId?: string | null; sessionEpoch?: number };
  subscribe: (listener: (state: { signedIn: boolean; signingIn: boolean; userCode?: string | null; signInStatus?: string | null; userId?: string | null; sessionEpoch?: number }) => void) => () => unknown;
  config: () => Promise<any>; signIn: () => Promise<void>; cancelSignIn: () => Promise<void>; logout: () => Promise<void>;
  account: (path?: string, options?: { method?: string; body?: unknown; signal?: AbortSignal }) => Promise<any>;
};
type Circle = { id: string; name: string; people: Person[] };
const c = { paper: '#F7F5EF', surface: '#FFFDF8', ink: '#183B35', muted: '#5F6F66', line: '#DDE3D8', celery: '#DCEABD', error: '#9B392F' };
function Button({ label, onPress, disabled = false, quiet = false }: { label: string; onPress: () => void; disabled?: boolean; quiet?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.button, quiet && s.quiet, disabled && { opacity: 0.45 }, pressed && { opacity: 0.7 }]}><Text style={[s.buttonText, quiet && { color: c.ink }]}>{label}</Text></Pressable>;
}
const message = (e: unknown) => e instanceof Error ? e.message : 'This account request could not be completed.';

/** Account data is deliberately memory-only, separate from the device library. */
export function NativeAccountScreen({ session, onOpenPlan, onImportCircle }: {
  session: Session; onOpenPlan: (plan: Plan, options: { editable: boolean }) => void; onImportCircle: (circle: Circle) => void;
}) {
  const [auth, setAuth] = useState(session.getSnapshot()), [enabled, setEnabled] = useState<boolean | null>(null);
  const [account, setAccount] = useState<any>(null), [plans, setPlans] = useState<any[]>([]), [inbox, setInbox] = useState<any[]>([]);
  const [circlePlans, setCirclePlans] = useState<any[]>([]), [profileEdit, setProfileEdit] = useState<{ name: string; artists: string; vibes: string } | null>(null);
  const [invitationError, setInvitationError] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [invited, setInvited] = useState<any>(null), [manager, setManager] = useState<any>(null);
  const previousAuth = useRef(auth.signedIn);
  const control = useRef(new AbortController()), locked = useRef(false), alive = useRef(true), generation = useRef(0);
  const clear = () => { setAccount(null); setPlans([]); setCirclePlans([]); setProfileEdit(null); setInbox([]); setInvited(null); setManager(null); setNotice(''); setInvitationError(''); };
  const run = async (fn: (signal: AbortSignal) => Promise<void>) => {
    if (locked.current) return; locked.current = true; setBusy(true); setError('');
    const version = generation.current;
    try { await fn(control.current.signal); } catch (e) { if (alive.current && version === generation.current) setError(message(e)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  };
  async function refresh(signal: AbortSignal) {
    setInvited(null); setManager(null);
    const [next, saved, shared] = await Promise.all([session.account('', { signal }), session.account('/plans', { signal }), session.account('/circle-plans', { signal })]);
    if (signal.aborted) return;
    setAccount(next); setPlans(Array.isArray(saved.plans) ? saved.plans : []); setCirclePlans(Array.isArray(shared.plans) ? shared.plans : []);
    try { const mail = await session.account('/invitations', { signal }); if (!signal.aborted) { setInbox(mail.invitations || []); setInvitationError(''); } }
    catch (e) { if (!signal.aborted) { setInbox([]); setInvitationError(message(e)); } }
  }
  useEffect(() => {
    alive.current = true;
    const unsubscribe = session.subscribe(next => {
      setAuth(next);
      if (!next.signedIn && previousAuth.current) { generation.current++; control.current.abort(); control.current = new AbortController(); clear(); }
      previousAuth.current = next.signedIn;
    });
    void session.config().then(config => { if (alive.current) setEnabled(config.enabled === true); }).catch(e => { if (alive.current) setError(message(e)); });
    return () => { alive.current = false; generation.current++; control.current.abort(); unsubscribe(); };
  }, [session]);
  useEffect(() => { if (auth.signedIn) void run(refresh); }, [auth.signedIn]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      // Never leave an access-controlled invitation visible while backgrounded.
      setInvited(null); setManager(null);
      if (state !== 'active') { generation.current++; control.current.abort(); control.current = new AbortController(); }
      if (state === 'active' && session.getSnapshot().signedIn) void run(refresh);
    });
    return () => listener.remove();
  }, [session]);
  useEffect(() => {
    if (!invited) return;
    const id = invited.invitationId;
    // The returned projection may omit invitationId; retain it only in this view.
    if (!id) return;
    let stopped = false;
    const timer = setInterval(() => {
      if (locked.current) return;
      void session.account(`/invitations/${encodeURIComponent(id)}/plan`, { signal: control.current.signal }).then(next => {
        if (!stopped && alive.current) {
          if (next.revision !== invited.revision) { setInvited(null); setNotice('This invitation changed. Refresh and review it again.'); }
        }
      }).catch(() => { if (!stopped && alive.current) setInvited(null); });
    }, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [invited, session]);
  const respond = (row: any, action: string) => void run(async signal => {
    setInvited(null); await session.account(`/invitations/${encodeURIComponent(row.id)}`, { method: 'PATCH', body: { action }, signal });
    if (!signal.aborted) { setNotice('Response saved to your account. It is not proof of attendance.'); await refresh(signal); }
  });
  const manage = (plan: any) => void run(async signal => {
    const data = await session.account(`/plans/${encodeURIComponent(plan.id)}/invitations`, { signal });
    if (!signal.aborted) { if (data.revision !== plan.revision) throw new Error('This plan changed. Refresh and reopen it before inviting anyone.'); setManager({ plan, ...data }); }
  });
  const confirmSession = (action: () => void) => {
    const captured = session.getSnapshot();
    return () => {
      const current = session.getSnapshot();
      if (!captured.signedIn || !current.signedIn || current.userId !== captured.userId || current.sessionEpoch !== captured.sessionEpoch) {
        setError('Your account session changed. Reopen this action from the current account.'); return;
      }
      action();
    };
  };
  const useCircle = (circle: Circle) => Alert.alert(`Use ${circle.name}?`, 'Bring these account names and tastes into this outing only. This does not invite anyone or change account membership.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Use circle', onPress: confirmSession(() => onImportCircle(circle)) },
  ]);
  const send = (person: Person, previous?: any) => {
    const current = manager;
    Alert.alert(`${previous ? 'Send updated invitation to' : 'Invite'} ${person.name}?`, `Share “${current.plan.title || 'Your plan'}”, revision ${current.revision}, in their Unstressed inbox. They can see the read-only itinerary after choosing Interested or Going. No email will be sent.${previous ? ' This replaces the previous invitation access and needs a new response.' : ''}`, [
      { text: 'Cancel', style: 'cancel' }, { text: 'Send invitation', onPress: confirmSession(() => void run(async signal => {
        await session.account(`/plans/${encodeURIComponent(current.plan.id)}/invitations`, { method: 'POST', body: { recipientId: person.id, revision: current.revision, ...(previous?.status === 'unavailable' ? { replaceInvitationId: previous.id } : {}) }, signal });
        if (!signal.aborted) { const data = await session.account(`/plans/${encodeURIComponent(current.plan.id)}/invitations`, { signal }); if (!signal.aborted) { setManager({ plan: current.plan, ...data }); setNotice('Invitation added to their in-app inbox. Delivery and attendance are not confirmed.'); } }
      })) },
    ]);
  };
  const withdraw = (row: any) => {
    const current = manager;
    Alert.alert('Withdraw invitation?', `End this invitation's itinerary access for ${row.recipientName || 'this person'}. Separate circle access is unchanged.`, [
      { text: 'Cancel', style: 'cancel' }, { text: 'Withdraw', style: 'destructive', onPress: confirmSession(() => void run(async signal => {
        await session.account(`/plans/${encodeURIComponent(current.plan.id)}/invitations/${encodeURIComponent(row.id)}`, { method: 'DELETE', body: {}, signal });
        const data = await session.account(`/plans/${encodeURIComponent(current.plan.id)}/invitations`, { signal });
        if (!signal.aborted) { setManager({ plan: current.plan, ...data }); setNotice('Invitation withdrawn. Separate circle access is unchanged.'); }
      })) },
    ]);
  };
  const saveProfile = () => {
    if (!profileEdit || !account?.user) return;
    const values = profileEdit, original = account.user.profile;
    Alert.alert('Save account profile?', 'Your name and tastes are shared with account circles you belong to. This changes your cloud profile, not device-only people.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Save profile', onPress: confirmSession(() => void run(async signal => {
        const list = (value: string) => [...new Set(value.split(',').map(x => x.trim()).filter(Boolean))];
        await session.account('/profile', { method: 'PATCH', body: { name: values.name.trim(), artists: list(values.artists), vibes: list(values.vibes), ...(original.spending ? { spending: original.spending } : {}), ...(original.context ? { context: original.context } : {}) }, signal });
        if (!signal.aborted) { setProfileEdit(null); await refresh(signal); setNotice('Account profile saved.'); }
      })) },
    ]);
  };
  return <ScrollView style={s.root} contentContainerStyle={s.content}>
    <Text style={s.eyebrow}>YOUR ACCOUNT</Text><Text style={s.title}>{account?.user ? `Hello, ${account.user.profile?.name || 'you'}.` : 'A little more you.'}</Text>
    <Text style={s.body}>Account plans, circles and invitations live here. Saved and Circles tabs keep separate copies on this device.</Text>
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}{!!notice && <Text accessibilityLiveRegion="polite" style={s.body}>{notice}</Text>}
    {!!busy && <ActivityIndicator color={c.ink} accessibilityLabel="Updating account" />}
    {!auth.signedIn ? <View style={s.card}>
      <Text style={s.heading}>{auth.signingIn ? 'Approve in your browser' : 'Keep your people close.'}</Text>
      <Text style={s.body}>{auth.signingIn ? 'Check that the approval code below matches the browser, then sign in and approve this app. Return here afterward. Never approve a code from someone else.' : enabled === false ? 'Native account access is not enabled on this server. You can keep planning as a guest.' : 'Sign in through the Unstressed website in your system browser. This app session is temporary and is not saved on this device.'}</Text>
      {auth.signingIn && !!auth.signInStatus && <Text accessibilityLiveRegion="polite" style={s.body}>{auth.signInStatus}</Text>}
      {auth.signingIn && !!auth.userCode && <Text selectable style={s.heading}>Approval code: {auth.userCode}</Text>}
      {auth.signingIn ? <Button label="Cancel sign-in" quiet onPress={() => void session.cancelSignIn().catch(e => setError(message(e)))} /> : <Button label="Continue in browser" disabled={enabled !== true || busy} onPress={() => void run(async () => { try { await session.signIn(); if (alive.current && session.getSnapshot().signedIn) await refresh(control.current.signal); } catch (cause) { if (alive.current) setError(message(cause)); } })} />}
      {enabled === null && <Button label="Check account availability" quiet disabled={busy} onPress={() => void run(async () => { const config = await session.config(); setEnabled(config.enabled === true); })} />}
    </View> : <>
      <View style={s.card}><Text style={s.heading}>{account?.user?.email || 'Your signed-in account'}</Text>
        <Text style={s.body}>Tastes: {(account?.user?.profile?.artists || []).join(', ') || 'None saved'}</Text>
        <Text style={s.caption}>Signing out removes this app session, not your cloud account, cloud invitations or device library.</Text>
        <Button label="Edit account name and tastes" quiet disabled={busy || !account?.user} onPress={() => setProfileEdit({ name: account.user.profile.name, artists: (account.user.profile.artists || []).join(', '), vibes: (account.user.profile.vibes || []).join(', ') })} />
        {profileEdit && <View style={s.section}><Text style={s.caption}>Separate entries with commas. Existing spending preferences are kept.</Text>
          {(['name', 'artists', 'vibes'] as const).map(field => <View key={field} style={s.section}><Text style={s.body}>{field === 'name' ? 'Your name' : field === 'artists' ? 'Artists' : 'Vibes'}</Text><TextInput accessibilityLabel={`Account ${field}`} editable={!busy} value={profileEdit[field]} maxLength={field === 'name' ? 80 : 600} style={s.input} onChangeText={value => setProfileEdit({ ...profileEdit, [field]: value })} /></View>)}
          <Button label="Save account profile" disabled={busy || !profileEdit.name.trim()} onPress={saveProfile} /><Button label="Cancel profile edit" quiet disabled={busy} onPress={() => setProfileEdit(null)} />
        </View>}
        <Button label="Refresh account" quiet disabled={busy} onPress={() => void run(refresh)} />
        <Button label="Sign out of this app" quiet onPress={() => { void session.logout().catch(e => setError(message(e))); }} />
      </View>
      <Text style={s.heading}>Cloud saved plans</Text><Text style={s.caption}>Open the server-saved revision. Hours and availability may have changed.</Text>
      {!plans.length && <Text style={s.body}>No account plans yet.</Text>}
      {plans.map(plan => <View key={plan.id} style={s.card}><Text style={s.heading}>{plan.title || 'Your outing'}</Text><Text style={s.body}>{plan.area} · {plan.date || 'Date not set'} · Revision {plan.revision}</Text>
        <Button label="Open account plan" disabled={busy} onPress={() => void run(async signal => { const full = await session.account(`/plans/${encodeURIComponent(plan.id)}`, { signal }); if (!signal.aborted) onOpenPlan(full, { editable: true }); })} />
        <Button label="Invite connected people" quiet disabled={busy || !!invitationError} onPress={() => manage(plan)} />
      </View>)}
      {manager && <View style={s.card}><Text style={s.heading}>Invite to {manager.plan.title || 'your plan'}</Text><Text style={s.caption}>In-app invitations only. Adding a person to a draft never sends an invitation. Existing circle access is separate.</Text>
        {!connectedPeople(account).length && <Text style={s.body}>No connected account people yet. Device-only names cannot receive invitations.</Text>}
        {connectedPeople(account).map((person: Person) => { const row = manager.invitations?.find((r: any) => r.recipientId === person.id), update = row && (row.revision !== manager.revision || row.status === 'unavailable'); return <View key={person.id} style={s.section}><Text style={s.body}>{person.name} · {row?.status || 'Not invited'}{row ? ` · Revision ${row.revision}` : ''}</Text>{row?.status !== 'disconnected' && (!row || update) && <Button label={update ? `Send update to ${person.name}` : `Invite ${person.name}`} disabled={busy || manager.revision !== manager.plan.revision} onPress={() => send(person, row)} />}{row && ['pending', 'interested', 'going'].includes(row.status) && <Button label={`Withdraw invitation for ${person.name}`} quiet disabled={busy} onPress={() => withdraw(row)} />}</View>; })}
        {(manager.invitations || []).filter((row: any) => !connectedPeople(account).some((p: Person) => p.id === row.recipientId)).map((row: any) => <View key={row.id} style={s.section}><Text style={s.body}>{row.recipientName || 'Previous recipient'} · {row.status}</Text>{['pending', 'interested', 'going'].includes(row.status) && <Button label="Withdraw previous invitation" quiet disabled={busy} onPress={() => withdraw(row)} />}</View>)}
        <Button label="Close invitations" quiet onPress={() => setManager(null)} />
      </View>}
      <Text style={s.heading}>Plans shared by your circles</Text><Text style={s.caption}>Open as an independent outing. Editing will not change the owner's plan.</Text>
      {!circlePlans.length && <Text style={s.body}>No circle-shared plans yet.</Text>}
      {circlePlans.map(plan => <View key={`${plan.ownerId}:${plan.id}`} style={s.card}><Text style={s.heading}>{plan.title || 'Circle outing'}</Text><Text style={s.body}>{plan.circleName} · {plan.area} · Revision {plan.revision}</Text><Button label="Open independent outing" quiet disabled={busy} onPress={() => void run(async signal => { const full = await session.account(`/circle-plans/${encodeURIComponent(plan.ownerId)}/${encodeURIComponent(plan.id)}`, { signal }); if (!signal.aborted) onOpenPlan(full, { editable: false }); })} /></View>)}
      <Text style={s.heading}>Account circles</Text><Text style={s.caption}>Nothing is copied to your device automatically.</Text>
      {(account?.circles || []).map((circle: Circle) => <View key={circle.id} style={s.card}><Text style={s.heading}>{circle.name}</Text><Text style={s.body}>{circle.people.map(person => person.name).join(', ')}</Text>
        <Button label="Use circle in this outing" quiet disabled={busy} onPress={() => useCircle(circle)} />
      </View>)}
      {!account?.circles?.length && <Text style={s.body}>No account circles yet.</Text>}
      <Text style={s.heading}>Invitation inbox</Text><Text style={s.caption}>Interested and Going unlock a read-only itinerary. Declining does not remove separate circle access.</Text>
      {!!invitationError && <Text style={s.error}>{invitationError}</Text>}{!inbox.length && !invitationError && <Text style={s.body}>No invitations yet.</Text>}
      {inbox.map(row => <View style={s.card} key={row.id}><Text style={s.heading}>{row.title || 'An outing'}</Text><Text style={s.body}>From {row.organizerName} · {row.date || 'Date not set'} · Revision {row.revision}</Text><Text style={s.caption}>{row.status}{row.previousResponse ? ` · Previously ${row.previousResponse.status}; updated plans need a new response.` : ''}</Text>
        {['pending', 'interested', 'going'].includes(row.status) && <><Button label="Interested" quiet disabled={busy} onPress={() => respond(row, 'interested')} /><Button label="Going" quiet disabled={busy} onPress={() => respond(row, 'going')} /><Button label={row.status === 'pending' ? 'Decline' : 'Leave invitation'} quiet disabled={busy} onPress={() => respond(row, row.status === 'pending' ? 'decline' : 'leave')} /></>}
        {['interested', 'going'].includes(row.status) && <Button label="View read-only itinerary" disabled={busy} onPress={() => void run(async signal => { setInvited(null); const result = await session.account(`/invitations/${encodeURIComponent(row.id)}/plan`, { signal }); if (!signal.aborted) { if (result.revision !== row.revision) throw new Error('This invitation changed. Refresh and review it again.'); setInvited({ ...result, invitationId: row.id }); } })} />}
      </View>)}
      {invited && <View style={s.card}><Text style={s.heading}>{invited.title}</Text><Text style={s.caption}>Read-only · Revision {invited.revision}. Refresh to check whether access or the plan changed.</Text>{(invited.stops || []).map((stop: any, index: number) => <View style={s.section} key={`${stop.id}:${index}`}><Text style={s.heading}>{stop.name}</Text><Text style={s.body}>{stop.intent} · {stop.start && stop.end ? `${stop.start}–${stop.end}` : 'Time to choose'}{stop.address ? `\n${stop.address}` : ''}</Text></View>)}<Button label="Close itinerary" quiet onPress={() => setInvited(null)} /></View>}
    </>}
  </ScrollView>;
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.paper }, content: { padding: 22, gap: 16, paddingBottom: 48 },
  eyebrow: { color: c.muted, fontFamily: 'Manrope_700Bold', fontSize: 11, letterSpacing: 1.8 },
  title: { color: c.ink, fontFamily: 'Manrope_600SemiBold', fontSize: 30 }, heading: { color: c.ink, fontFamily: 'Manrope_600SemiBold', fontSize: 18 },
  body: { color: c.ink, fontFamily: 'Manrope_400Regular', fontSize: 15, lineHeight: 23 }, caption: { color: c.muted, fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 20 },
  card: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 20, padding: 18, gap: 13 },
  input: { minHeight: 48, borderWidth: 1, borderColor: c.line, borderRadius: 12, padding: 12, color: c.ink, fontFamily: 'Manrope_400Regular', fontSize: 16 },
  section: { gap: 8, paddingVertical: 8 }, button: { minHeight: 48, borderRadius: 24, paddingHorizontal: 18, paddingVertical: 13, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' },
  quiet: { backgroundColor: c.celery }, buttonText: { fontFamily: 'Manrope_600SemiBold', color: c.surface, fontSize: 14 }, error: { color: c.error, fontFamily: 'Manrope_500Medium', fontSize: 14, lineHeight: 22 },
});
