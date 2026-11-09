import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  applyCircleToBrief, CIRCLE_TASTES, createLibraryStore, localIdentity,
  sanitizeDraft, sanitizePerson,
} from "../library";
import { planTitle } from "../planning";
import type { Brief, Draft, Person } from "../types";

type RecordBase = { id: string; name: string; createdAt: string; updatedAt: string; removedAt?: string };
type SavedPlan = RecordBase & { draft: Draft };
type Circle = RecordBase & { people: Person[] };
type Library = { version: number; plans: SavedPlan[]; circles: Circle[] };
type Kind = "plans" | "circles";
type Feedback = { onError?: (message: string) => void; onNotice?: (message: string) => void };
const disk = createLibraryStore(AsyncStorage);
const colors = { paper: "#F7F5EF", surface: "#FFFDF8", ink: "#183B35", muted: "#5F6F66", line: "#DDE3D8", celery: "#DCEABD", error: "#9B392F" };
const errorText = (error: unknown) => error instanceof Error ? error.message : "The library could not be updated. Please try again.";

function Action({ label, onPress, disabled, quiet, danger, icon }: {
  label: string; onPress: () => void; disabled?: boolean; quiet?: boolean; danger?: boolean;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, quiet && styles.quiet, danger && styles.dangerButton, disabled && styles.disabled, pressed && styles.pressed]}>
    {!!icon && <Ionicons name={icon} size={19} color={quiet || danger ? (danger ? colors.error : colors.ink) : colors.surface} />}
    <Text style={[styles.buttonText, quiet && styles.quietText, danger && styles.dangerText]}>{label}</Text>
  </Pressable>;
}
function Field({ label, value, onChange, maxLength, placeholder, multiline, disabled }: {
  label: string; value: string; onChange: (value: string) => void; maxLength: number; placeholder?: string; multiline?: boolean; disabled?: boolean;
}) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text>
    <TextInput editable={!disabled} accessibilityLabel={label} value={value} onChangeText={onChange} maxLength={maxLength}
      placeholder={placeholder} placeholderTextColor={colors.muted} multiline={multiline}
      style={[styles.input, multiline && styles.multiline]} returnKeyType={multiline ? "default" : "done"}
      onSubmitEditing={multiline ? undefined : Keyboard.dismiss} />
  </View>;
}
function Banner({ error, notice }: { error: string; notice: string }) {
  return <>{!!error && <View style={styles.errorBox}><Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.errorText}>{error}</Text></View>}
    {!!notice && !error && <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}</>;
}
function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return <View style={styles.heading}><Text style={styles.eyebrow}>ON THIS DEVICE</Text><Text style={styles.title}>{title}</Text><Text style={styles.body}>{subtitle}</Text></View>;
}
function Privacy() {
  return <View style={styles.privacy}><Ionicons name="phone-portrait-outline" size={18} color={colors.muted} />
    <Text style={styles.privacyText}>Stored on this device, without app-level encryption. Chat sends your draft and saved circle names and tastes to Unstressed for planning. No account sync or invitations.</Text></View>;
}
function Empty({ icon, title, detail }: { icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; detail: string }) {
  return <View style={styles.empty}><View style={styles.emptyIcon}><Ionicons name={icon} size={30} color={colors.ink} /></View><Text style={styles.cardTitle}>{title}</Text><Text style={styles.body}>{detail}</Text></View>;
}
function useLibrary(feedback: Feedback) {
  const [library, setLibrary] = useState<Library>({ version: 2, plans: [], circles: [] });
  const [busy, setBusy] = useState(true), [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const mounted = useRef(false), locked = useRef(false);
  const callbacks = useRef(feedback); callbacks.current = feedback;
  const report = (value: unknown) => { const message = errorText(value); if (mounted.current) setError(message); callbacks.current.onError?.(message); };
  const load = async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { const next = await disk.load(); if (mounted.current) { setLibrary(next as Library); setLoaded(true); } }
    catch (cause) { report(cause); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);
  const run = async (operation: () => Promise<unknown>, message: string, done?: () => void) => {
    if (locked.current || !loaded) return;
    locked.current = true; setBusy(true); setError(""); setNotice(""); Keyboard.dismiss();
    try {
      const next = await operation();
      if (mounted.current) { setLibrary(next as Library); setNotice(message); done?.(); callbacks.current.onNotice?.(message); }
    } catch (cause) { report(cause); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  return { library, busy, loaded, error, notice, report, run, reload: load };
}
function removeItem(kind: Kind, record: RecordBase, run: ReturnType<typeof useLibrary>["run"]) {
  Alert.alert(`Remove “${record.name}”?`, "You can restore it from Recently removed on this device.", [
    { text: "Keep", style: "cancel" },
    { text: "Remove", style: "destructive", onPress: () => void run(() => disk.remove(kind, record.id), "Moved to Recently removed. You can restore it below.") },
  ]);
}
function RecentlyRemoved({ records, kind, busy, run }: { records: RecordBase[]; kind: Kind; busy: boolean; run: ReturnType<typeof useLibrary>["run"] }) {
  const [expanded, setExpanded] = useState(false);
  if (!records.length) return null;
  return <View style={styles.section}>
    <Action label={`Recently removed (${records.length})${expanded ? " · Hide" : " · Show"}`} quiet onPress={() => setExpanded(!expanded)} icon="arrow-undo-outline" />
    {expanded && <><Text style={styles.caption}>Removed items stay here until you restore or permanently delete them. They still count toward your device library limit.</Text>
      {records.map((record) => <View style={styles.card} key={record.id}>
        <Text style={styles.cardTitle}>{record.name}</Text>
        <View style={styles.actions}><Action label="Restore" quiet disabled={busy} onPress={() => void run(() => disk.restore(kind, record.id), "Restored to your device library.")} />
          <Action label="Delete permanently" danger disabled={busy} onPress={() => Alert.alert(`Permanently delete “${record.name}”?`, "This copy will be erased from this device. You cannot undo this.", [
            { text: "Cancel", style: "cancel" }, { text: "Delete permanently", style: "destructive", onPress: () => void run(() => disk.deletePermanently(kind, record.id), "The removed copy was permanently deleted.") },
          ])} /></View>
      </View>)}</>}
  </View>;
}
function EditorFrame({ title, children, onClose, busy }: { title: string; children: React.ReactNode; onClose: () => void; busy: boolean }) {
  return <Modal visible transparent animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
    <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.modalCard}><View style={styles.modalHeader}><Text style={styles.modalTitle}>{title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close editor" accessibilityState={{ disabled: busy }} disabled={busy} onPress={onClose} style={styles.close}>
          <Ionicons name="close" size={24} color={colors.ink} />
        </Pressable></View>{children}</View>
    </KeyboardAvoidingView>
  </Modal>;
}

/** Parent owns navigation and confirms any replacement of the current draft. */
export function SavedPlansScreen({ currentDraft, onOpen, onError, onNotice }: {
  currentDraft: Draft; onOpen: (draft: Draft) => void;
} & Feedback) {
  const state = useLibrary({ onError, onNotice });
  const [rename, setRename] = useState<{ record: SavedPlan; value: string } | null>(null);
  const active = state.library.plans.filter((p) => !p.removedAt);
  const changedDraft = !!currentDraft.plan && JSON.stringify(currentDraft.brief) !== JSON.stringify(currentDraft.plan.request);
  const closeRename = () => { Keyboard.dismiss(); setRename(null); };
  return <View style={styles.root}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
    <Header title="Good days, kept." subtitle="Keep a copy you can come back to. Opening a saved plan does not check current hours or availability." />
    <Privacy />
    <View style={styles.saveCard}><Text style={styles.cardTitle}>Your current plan</Text>
      <Text style={styles.body}>{currentDraft.plan ? planTitle(currentDraft.plan.request) : "Find places in Plan, then save your outing here."}</Text>
      {changedDraft && <Text style={styles.caption}>Draft changed. This copy keeps your updated draft and the previous result. Replan before relying on that result.</Text>}
      <Action label="Save current plan" icon="bookmark-outline" disabled={state.busy || !state.loaded || !currentDraft.plan}
        onPress={() => void state.run(() => disk.addPlan(currentDraft), "Saved a new copy on this device. Future edits will not change it.")} />
      <Text style={styles.caption}>Every save creates a separate copy. Nothing is overwritten automatically.</Text>
    </View>
    <Banner error={state.error} notice={state.notice} />
    {state.busy && <ActivityIndicator accessibilityLabel="Updating saved plans" color={colors.ink} />}
    {!state.loaded && !state.busy && <Action label="Try loading again" quiet onPress={() => void state.reload()} />}
    {state.loaded && <><View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Saved plans</Text><Text style={styles.caption}>{active.length} on this device</Text></View>
      {!active.length && <Empty icon="bookmark-outline" title="A little collection of good days" detail="Your saved plans will appear here, ready whenever you want to revisit them." />}
      {active.map((record) => <View style={styles.card} key={record.id}>
        <Text style={styles.cardTitle}>{record.name}</Text>
        <Text style={styles.body}>{record.draft.plan?.request.area || "Area not chosen"}</Text>
        <Text style={styles.caption}>{record.draft.plan?.request.timing.dateConfirmed ? record.draft.plan.request.date : "Date not chosen"} · {record.draft.plan?.stops.length || 0} stops · Saved {new Date(record.createdAt).toLocaleDateString()}</Text>
        {record.draft.plan && JSON.stringify(record.draft.brief) !== JSON.stringify(record.draft.plan.request) && <Text style={styles.caption}>Includes draft changes and a previous result. Replan to check the updated outing.</Text>}
        <View style={styles.actions}><Action label="Open plan" disabled={state.busy} onPress={() => { try { onOpen(sanitizeDraft(record.draft) as Draft); } catch (cause) { state.report(cause); } }} icon="arrow-forward-outline" />
          <Action label="Rename" quiet disabled={state.busy} onPress={() => setRename({ record, value: record.name })} />
          <Action label="Remove" quiet disabled={state.busy} onPress={() => removeItem("plans", record, state.run)} /></View>
      </View>)}
      <RecentlyRemoved records={state.library.plans.filter((p) => !!p.removedAt)} kind="plans" busy={state.busy} run={state.run} />
    </>}
  </ScrollView>
    {rename && <EditorFrame title="Name this saved copy" onClose={closeRename} busy={state.busy}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.editorContent}>
      <Text style={styles.body}>This changes the label in your library, not the outing inside the copy.</Text>
      <Field disabled={state.busy} label="Saved copy name" value={rename.value} maxLength={80} onChange={(value) => setRename({ ...rename, value })} />
      <Banner error={state.error} notice="" />
      <Action label="Save name" disabled={state.busy || !rename.value.trim()} onPress={() => void state.run(() => disk.renamePlan(rename.record.id, rename.value), "Saved copy renamed.", closeRename)} />
      <Action label="Cancel" quiet disabled={state.busy} onPress={closeRename} />
    </ScrollView></EditorFrame>}
  </View>;
}

type EditablePerson = Person & { artistsText: string };
type CircleForm = { id?: string; name: string; people: EditablePerson[] };
const editablePerson = (person: Person): EditablePerson => ({ ...sanitizePerson(person) as Person, artistsText: person.artists.join(", ") });
const newPerson = (): EditablePerson => ({ id: localIdentity("person"), name: "", artists: [], artistsText: "", vibes: [] });
const tasteLabel = (id: string) => CIRCLE_TASTES.find(([key]) => key === id)?.[1] || id.replace(/^v-/, "").replace(/[_-]/g, " ");

/** onApply receives a complete Brief; applying does not save or replan remotely. */
export function CirclesScreen({ currentDraft, onApply, onError, onNotice }: {
  currentDraft: Draft; onApply: (brief: Brief) => void;
} & Feedback) {
  const state = useLibrary({ onError, onNotice });
  const [form, setForm] = useState<CircleForm | null>(null), [dirty, setDirty] = useState(false);
  const [formError, setFormError] = useState("");
  const active = state.library.circles.filter((c) => !c.removedAt);
  const begin = (circle?: Circle) => {
    try {
      setForm(circle ? { id: circle.id, name: circle.name, people: circle.people.map(editablePerson) } : { name: "", people: currentDraft.brief.people.map(editablePerson) });
      setDirty(false); setFormError("");
    } catch (cause) { state.report(cause); }
  };
  const close = () => { Keyboard.dismiss(); setForm(null); setDirty(false); setFormError(""); };
  const cancel = () => {
    if (!dirty) { close(); return; }
    Alert.alert("Discard circle edits?", "Your saved circle and current outing have not changed.", [{ text: "Keep editing", style: "cancel" }, { text: "Discard edits", style: "destructive", onPress: close }]);
  };
  const update = (next: CircleForm) => { setForm(next); setDirty(true); setFormError(""); };
  const updatePerson = (personId: string, edit: Partial<EditablePerson>) => { if (form) update({ ...form, people: form.people.map((person) => person.id === personId ? { ...person, ...edit } : person) }); };
  const save = () => {
    if (!form) return;
    const people = form.people.map(({ artistsText, ...person }) => ({ ...person, artists: [...new Set(artistsText.split(",").map((name) => name.trim()).filter(Boolean))] }));
    if (people.some((person) => !person.name.trim())) { setFormError("Give each person a name, or remove the empty profile."); return; }
    if (people.some((person) => person.artists.length > 6)) { setFormError("Keep up to six artists per person."); return; }
    void state.run(() => disk.saveCircle({ ...form, people }), "Circle saved on this device. Apply it when you want to use it.", close);
  };
  return <View style={styles.root}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
    <Header title="Your kind of people." subtitle="Save familiar people and the tastes they’ve shared. Bring a circle into an outing when you choose." />
    <Privacy />
    <Action label="Create a circle" icon="add-outline" disabled={state.busy || !state.loaded} onPress={() => begin()} />
    <Text style={styles.caption}>Start with the people in your current draft. Saving or editing a circle leaves that draft unchanged.</Text>
    <Banner error={state.error} notice={state.notice} />
    {state.busy && <ActivityIndicator accessibilityLabel="Updating circles" color={colors.ink} />}
    {!state.loaded && !state.busy && <Action label="Try loading again" quiet onPress={() => void state.reload()} />}
    {state.loaded && <>{!active.length && <Empty icon="people-outline" title="Keep your people close" detail="A name is enough. Artists and other tastes are optional, and no one receives an invitation." />}
      {active.map((circle) => <View style={styles.card} key={circle.id}>
        <View style={styles.circleHeading}><View style={styles.avatars}>{circle.people.slice(0, 4).map((person, index) => <View key={person.id} style={[styles.avatar, index > 0 && styles.avatarOverlap]}><Text style={styles.avatarText}>{person.name.charAt(0).toUpperCase()}</Text></View>)}</View><Text style={styles.caption}>{circle.people.length} taste profile{circle.people.length === 1 ? "" : "s"}</Text></View>
        <Text style={styles.cardTitle}>{circle.name}</Text>
        <Text style={styles.body}>{circle.people.map((person) => person.name).join(" · ")}</Text>
        <Text style={styles.caption}>{circle.people.some((person) => person.artists.length || person.vibes.length) ? "Only tastes you’ve added are saved." : "No tastes added. Names are enough to start."}</Text>
        <Action label="Apply circle to current draft" disabled={state.busy} icon="arrow-forward-outline" onPress={() => {
          try { onApply(applyCircleToBrief(currentDraft.brief, circle) as Brief); }
          catch (cause) { state.report(cause); }
        }} />
        <View style={styles.actions}><Action label="Edit circle" quiet disabled={state.busy} onPress={() => begin(circle)} /><Action label="Remove" quiet disabled={state.busy} onPress={() => removeItem("circles", circle, state.run)} /></View>
      </View>)}
      <Text style={styles.caption}>Applying adds missing people without replacing current taste edits. Up to six named profiles; larger headcounts stay unchanged.</Text>
      <RecentlyRemoved records={state.library.circles.filter((circle) => !!circle.removedAt)} kind="circles" busy={state.busy} run={state.run} />
    </>}
  </ScrollView>
    {form && <EditorFrame title={form.id ? "Edit your circle" : "A new circle"} onClose={cancel} busy={state.busy}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.editorContent}>
        <Field disabled={state.busy} label="Circle name" value={form.name} maxLength={40} placeholder="Sunday people" onChange={(name) => update({ ...form, name })} />
        <Text style={styles.body}>Keep tastes optional. Add only what each person has shared.</Text>
        {form.people.map((person, index) => <View key={person.id} style={styles.personCard}>
          <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Person {index + 1}</Text><Text style={styles.caption}>Optional tastes below</Text></View>
          <Field disabled={state.busy} label={`Person ${index + 1} name`} value={person.name} maxLength={24} placeholder="Name" onChange={(name) => updatePerson(person.id, { name })} />
          <Field disabled={state.busy} label={`Artists for ${person.name || `person ${index + 1}`} (optional)`} value={person.artistsText} maxLength={966} placeholder="Artist names, separated by commas" multiline onChange={(artistsText) => updatePerson(person.id, { artistsText })} />
          <Text style={styles.caption}>Up to six artists. Leave blank if you don’t know.</Text>
          <View style={styles.tastes}>{[...new Set([...CIRCLE_TASTES.map(([key]) => key), ...person.vibes])].map((taste) => {
            const selected = person.vibes.includes(taste);
            return <Pressable key={taste} accessibilityRole="checkbox" accessibilityLabel={tasteLabel(taste)} accessibilityState={{ checked: selected, disabled: state.busy }} disabled={state.busy}
              onPress={() => updatePerson(person.id, { vibes: selected ? person.vibes.filter((id) => id !== taste) : [...person.vibes, taste] })}
              style={[styles.taste, selected && styles.tasteSelected]}><Text style={styles.tasteText}>{selected ? "✓ " : "+ "}{tasteLabel(taste)}</Text></Pressable>;
          })}</View>
          {form.people.length > 1 && <Action disabled={state.busy} label={`Remove ${person.name || `person ${index + 1}`} from circle`} quiet onPress={() => update({ ...form, people: form.people.filter((p) => p.id !== person.id) })} />}
        </View>)}
        {form.people.length < 6 && <Action label="Add a person" quiet icon="person-add-outline" disabled={state.busy} onPress={() => update({ ...form, people: [...form.people, newPerson()] })} />}
        <Text style={styles.caption}>Up to six taste profiles. You can still plan for a larger group without naming everyone.</Text>
        <Banner error={formError || state.error} notice="" />
        <Action label="Save circle on this device" disabled={state.busy || !form.name.trim()} onPress={save} />
        <Action label="Cancel" quiet disabled={state.busy} onPress={cancel} />
      </ScrollView>
    </EditorFrame>}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 36, gap: 16 },
  heading: { gap: 8 }, eyebrow: { fontFamily: "Manrope_700Bold", fontSize: 11, letterSpacing: 1.8, color: colors.muted },
  title: { fontFamily: "Manrope_700Bold", fontSize: 30, lineHeight: 38, letterSpacing: -1, color: colors.ink },
  body: { fontFamily: "Manrope_400Regular", fontSize: 14, lineHeight: 22, color: colors.muted },
  caption: { fontFamily: "Manrope_400Regular", fontSize: 12, lineHeight: 19, color: colors.muted },
  privacy: { flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 12, borderRadius: 14, backgroundColor: "#ECEFE5" },
  privacyText: { flex: 1, fontFamily: "Manrope_400Regular", fontSize: 12, lineHeight: 18, color: colors.muted },
  saveCard: { padding: 18, borderRadius: 22, backgroundColor: colors.celery, gap: 12 },
  card: { padding: 18, borderWidth: 1, borderColor: colors.line, borderRadius: 22, backgroundColor: colors.surface, gap: 10 },
  cardTitle: { fontFamily: "Manrope_700Bold", fontSize: 19, lineHeight: 26, color: colors.ink },
  section: { gap: 12 }, sectionHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  sectionTitle: { fontFamily: "Manrope_700Bold", fontSize: 17, color: colors.ink },
  button: { minHeight: 48, borderRadius: 15, paddingHorizontal: 16, paddingVertical: 13, backgroundColor: colors.ink, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  buttonText: { fontFamily: "Manrope_600SemiBold", fontSize: 13, lineHeight: 20, color: colors.surface, flexShrink: 1, textAlign: "center" },
  quiet: { backgroundColor: "#EDF0E8", borderWidth: 1, borderColor: colors.line }, quietText: { color: colors.ink },
  dangerButton: { backgroundColor: "#F7E9E5" }, dangerText: { color: colors.error },
  disabled: { opacity: 0.45 }, pressed: { opacity: 0.75 }, actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  errorBox: { padding: 12, borderRadius: 12, backgroundColor: "#F7E9E5" }, errorText: { fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 20, color: colors.error },
  notice: { fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 21, color: colors.ink },
  empty: { padding: 24, gap: 12, borderColor: colors.line, borderWidth: 1, borderStyle: "dashed", borderRadius: 22, backgroundColor: colors.surface },
  emptyIcon: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", backgroundColor: colors.celery },
  field: { gap: 7 }, fieldLabel: { fontFamily: "Manrope_600SemiBold", fontSize: 13, lineHeight: 20, color: colors.ink },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: 13, paddingHorizontal: 13, paddingVertical: 12, fontFamily: "Manrope_400Regular", fontSize: 15, color: colors.ink, backgroundColor: colors.surface },
  multiline: { minHeight: 82, textAlignVertical: "top" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(24,59,53,0.35)", justifyContent: "flex-end", paddingTop: 44 },
  modalCard: { maxHeight: "100%", borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: colors.paper, overflow: "hidden", flexShrink: 1 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 20, paddingRight: 8, paddingTop: 8 },
  modalTitle: { flex: 1, fontFamily: "Manrope_700Bold", fontSize: 20, color: colors.ink }, close: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  editorContent: { padding: 20, paddingBottom: 40, gap: 16 }, personCard: { gap: 12, paddingVertical: 16, borderTopWidth: 1, borderColor: colors.line },
  circleHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  avatars: { flexDirection: "row", paddingRight: 6 }, avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.celery, borderWidth: 2, borderColor: colors.surface, alignItems: "center", justifyContent: "center" },
  avatarOverlap: { marginLeft: -8 }, avatarText: { fontFamily: "Manrope_700Bold", fontSize: 15, color: colors.ink },
  tastes: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, taste: { minHeight: 48, paddingHorizontal: 12, paddingVertical: 13, borderWidth: 1, borderColor: colors.line, borderRadius: 14, justifyContent: "center", backgroundColor: colors.surface },
  tasteSelected: { backgroundColor: colors.celery, borderColor: "#B6D382" }, tasteText: { fontFamily: "Manrope_500Medium", fontSize: 12, color: colors.ink },
});
