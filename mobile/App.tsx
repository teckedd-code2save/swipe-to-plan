import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  useFonts,
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from "@expo-google-fonts/manrope";
import { StatusBar } from "expo-status-bar";
import * as Crypto from "expo-crypto";
import { NativeAccountScreen } from "./src/components/AccountScreen";
import { createAccountSession } from "./src/account-session";
import { createAccountWorkspace } from "./src/account-planning";
import { SavedPlansScreen, CirclesScreen } from "./src/components/SavedLibrary";
import { DayReadiness, VenueDetails } from "./src/components/DayDetails";
import { createLibraryStore, applyCircleToBrief } from "./src/library";
import { venueDetailsData } from "./src/day-details";
import Ionicons from "@expo/vector-icons/Ionicons";
import { fetch as expoFetch } from "expo/fetch";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiOrigin, createApi } from "./src/transport";
import {
  activityLabels,
  destinationTimeZone,
  chooseActivities,
  coarsePoint,
  confirmArea,
  editStop,
  groundedRoute,
  newBrief,
  planContext,
  planTitle,
  personWithId,
} from "./src/planning";
import { isBrief, requirePlan, requireAreas } from "./src/validation";
import { createDraftStore, createRequestGate } from "./src/lifecycle";
import type {
  Area,
  Brief,
  Draft,
  Intent,
  Message,
  Plan,
  Stop,
} from "./src/types";

const palette = {
  paper: "#F7F5EF",
  white: "#FFFDF8",
  ink: "#183B35",
  muted: "#5F6F66",
  line: "#DDE3D8",
  green: "#DCEABD",
  accent: "#B6D382",
  error: "#9B392F",
};
const origin = apiOrigin(process.env.EXPO_PUBLIC_API_ORIGIN, __DEV__);
const accountSession = createAccountSession({
  origin, development: __DEV__, fetch: expoFetch,
  randomBytes: Crypto.getRandomBytesAsync,
  sha256: (value: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value, { encoding: Crypto.CryptoEncoding.BASE64 }),
  openBrowser: (url: string) => Linking.openURL(url),
});
const accountWorkspace = createAccountWorkspace();
const api = createApi({
  origin, fetch: expoFetch,
  getAuthorization: accountSession.getAuthorization,
  getPlanHeaders: accountWorkspace.headers,
  onUnauthorized: (header: string) => accountSession.invalidateAuthorization(header),
});
const disk = createDraftStore(AsyncStorage);
const library = createLibraryStore(AsyncStorage);
type IconName = React.ComponentProps<typeof Ionicons>["name"];
const icons: Record<Intent, IconName> = {
  coffee: "cafe-outline",
  activity: "leaf-outline",
  dinner: "restaurant-outline",
  drinks: "wine-outline",
};
const initial: Draft = {
  brief: newBrief() as Brief,
  confirmed: false,
  plan: null,
};

function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <Image
      source={require("./assets/brand/unstressed-mark.png")}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessible={false}
    />
  );
}

function Icon({
  name,
  size = 20,
  color = palette.ink,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <Ionicons name={name} size={size} color={color} />;
}
function Button({
  label,
  onPress,
  disabled,
  quiet,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  quiet?: boolean;
  icon?: IconName;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        quiet && styles.quietButton,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {!!icon && <Icon name={icon} color={quiet ? palette.ink : palette.white} />}
      <Text style={[styles.buttonText, quiet && styles.quietText]}>
        {label}
      </Text>
    </Pressable>
  );
}
function Chip({
  label,
  selected,
  onPress,
  icon,
  disabled,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: IconName;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.chip,
        selected && styles.chipSelected,
        disabled && styles.disabled,
      ]}
    >
      {!!icon && <Icon name={icon} size={17} />}
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}
function Sheet({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  return (
    <Modal animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          accessibilityLabel="Close sheet"
          onPress={close}
          style={styles.backdrop}
        />
        <SafeAreaView edges={["bottom", "top"]} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={close}
              style={styles.iconButton}
            >
              <Icon name="close" />
            </Pressable>
          </View>
          {children}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
function Note({ text, error = false }: { text: string; error?: boolean }) {
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={[styles.note, error && { color: palette.error }]}
    >
      {text}
    </Text>
  );
}
function Field({
  label,
  value,
  onChangeText,
  placeholder,
  numeric = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  numeric?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.muted}
        keyboardType={numeric ? "number-pad" : "default"}
        autoCorrect={false}
      />
    </View>
  );
}

function LocationSheet({
  query: firstQuery,
  close,
  choose,
}: {
  query: string;
  close: () => void;
  choose: (area: Area) => void;
}) {
  const [query, setQuery] = useState(firstQuery),
    [areas, setAreas] = useState<Area[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [searched, setSearched] = useState(false);
  const gate = useRef(createRequestGate());
  useEffect(() => {
    const job = gate.current.begin();
    setAreas([]);
    setError("");
    setSearched(false);
    setBusy(false);
    if (query.trim().length < 2) return () => gate.current.invalidate();
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const result = await api.locations(query, job.signal);
        if (job.current()) {
          setAreas(requireAreas(result));
          setSearched(true);
        }
      } catch (error) {
        if (job.current())
          setError(
            error instanceof Error ? error.message : "Area search failed.",
          );
      } finally {
        if (job.current()) setBusy(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      gate.current.invalidate();
    };
  }, [query]);
  async function nearby() {
    Keyboard.dismiss();
    const job = gate.current.begin();
    setBusy(true);
    setError("");
    setAreas([]);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!job.current()) return;
      if (permission.status !== "granted")
        throw new Error(
          "Location access is off. You can still search by area above.",
        );
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (!job.current()) return;
      const result = await api.nearby(coarsePoint(position), job.signal);
      if (job.current()) {
        setAreas(requireAreas(result));
        setSearched(true);
      }
    } catch (error) {
      if (job.current())
        setError(
          error instanceof Error
            ? error.message
            : "Your location could not be found. Search by area instead.",
        );
    } finally {
      if (job.current()) setBusy(false);
    }
  }
  return (
    <Sheet title="Where feels right?" close={close}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.sheetBody}
      >
        <Text style={styles.body}>
          Choose a city or neighborhood. This sets the search area, not your
          current location.
        </Text>
        <Field
          label="City or neighborhood"
          value={query}
          onChangeText={setQuery}
          placeholder="Try East Legon, Accra"
        />
        <Button
          quiet
          icon="locate-outline"
          label="Use my location"
          onPress={nearby}
          disabled={busy}
        />
        <Text style={styles.small}>
          Only after you tap: one foreground fix, rounded to about 1 km, sent to
          Unstressed and its location provider. No background tracking.
        </Text>
        {!!busy && (
          <ActivityIndicator
            accessibilityLabel="Finding areas"
            color={palette.ink}
          />
        )}
        {!!error && <Note text={error} error />}
        {searched && !busy && !areas.length && (
          <Note text="No matching areas returned. Try a nearby city or a more specific name." />
        )}
        {areas.map((area) => (
          <Pressable
            key={area.id}
            accessibilityRole="button"
            onPress={() => {
              gate.current.invalidate();
              choose(area);
            }}
            style={styles.areaRow}
          >
            <View style={styles.areaIcon}>
              <Icon name="location-outline" />
            </View>
            <View style={styles.flex}>
              <Text style={styles.itemTitle}>{area.name}</Text>
              <Text style={styles.small}>{area.label}</Text>
            </View>
            <Icon name="arrow-forward" />
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  );
}

function ReviewSheet({
  draft,
  close,
  apply,
}: {
  draft: Draft;
  close: () => void;
  apply: (brief: Brief) => void;
}) {
  const [brief, setBrief] = useState<Brief>(draft.brief),
    [budget, setBudget] = useState(draft.brief.budget?.toString() || ""),
    [date, setDate] = useState(
      draft.brief.timing.dateConfirmed ? draft.brief.date : "",
    ),
    [error, setError] = useState("");
  const [artists, setArtists] = useState(
    draft.brief.people[0].artists.join(", "),
  );
  const [deck, setDeck] = useState<
    { id: string; label: string; kind: string }[]
  >([]);
  useEffect(() => {
    const controller = new AbortController();
    api
      .deck(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted)
          setDeck(
            Array.isArray(result)
              ? result.filter((card) => card.kind === "vibe")
              : [],
          );
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const update = (patch: Partial<Brief>) =>
    setBrief((current) => ({ ...current, ...patch }));
  function submit() {
    if (!brief.activities.length) {
      setError("Choose at least one kind of stop.");
      return;
    }
    if (
      budget &&
      (!/^\d+$/.test(budget) || Number(budget) < 1 || Number(budget) > 10000000)
    ) {
      setError("Enter a whole-number allowance, or leave it open.");
      return;
    }
    if (
      date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        Number.isNaN(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date)
    ) {
      setError("Use a real date in YYYY-MM-DD format, or leave it open.");
      return;
    }
    if (!/^[A-Z]{3}$/.test(brief.currency)) {
      setError("Use a three-letter currency code, such as GHS or USD.");
      return;
    }
    if (
      brief.timing.timeConfirmed &&
      (!/^([01]\d|2[0-3]):[0-5]\d$/.test(brief.startTime) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(brief.endTime) ||
        brief.endTime <= brief.startTime)
    ) {
      setError(
        "Use a same-day time window in HH:MM format, ending after it starts.",
      );
      return;
    }
    const names = [
      ...new Set(
        artists
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean),
      ),
    ];
    if (names.length > 6 || names.some((name) => name.length > 160)) {
      setError("Use up to six artists, each under 160 characters.");
      return;
    }
    apply({
      ...brief,
      budget: budget ? Number(budget) : null,
      date: date || brief.date,
      timing: { ...brief.timing, dateConfirmed: !!date },
      people: [
        { ...brief.people[0], artists: names },
        ...brief.people.slice(1),
      ],
    });
  }
  return (
    <Sheet title="A little shape to your day" close={close}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.sheetBody}
      >
        <Text style={styles.eyebrow}>
          {brief.area || "Choose an area next"}
        </Text>
        <Text style={styles.label}>What sounds good?</Text>
        <View style={styles.wrap}>
          {(Object.keys(activityLabels) as Intent[]).map((intent) => (
            <Chip
              key={intent}
              icon={icons[intent]}
              label={activityLabels[intent]}
              selected={brief.activities.includes(intent)}
              onPress={() => {
                if (brief.party.children && intent === "drinks") {
                  setError(
                    "Choose coffee, exploring or a meal when children are coming.",
                  );
                  return;
                }
                const activities = brief.activities.includes(intent)
                  ? brief.activities.filter((value) => value !== intent)
                  : [...brief.activities, intent];
                if (activities.length > 3) {
                  setError("Choose up to three kinds of stop.");
                  return;
                }
                setBrief(chooseActivities(brief, activities) as Brief);
                setError("");
              }}
            />
          ))}
        </View>
        <Text style={styles.label}>Who is coming?</Text>
        <View style={styles.stepper}>
          <Text style={styles.body}>
            {brief.party.adults + brief.party.children}{" "}
            {brief.party.adults + brief.party.children === 1
              ? "person"
              : "people"}{" "}
            · {brief.party.children} children
          </Text>
          <View style={styles.row}>
            <Chip
              label="−"
              onPress={() =>
                update({
                  party: {
                    ...brief.party,
                    adults: Math.max(
                      1,
                      brief.people.length - brief.party.children,
                      brief.party.adults - 1,
                    ),
                  },
                })
              }
            />
            <Chip
              label="+"
              onPress={() =>
                update({
                  party: {
                    ...brief.party,
                    adults: Math.min(100, brief.party.adults + 1),
                  },
                })
              }
            />
          </View>
        </View>
        <Text style={styles.small}>
          Solo by default. Extra guests have no invented taste profiles. Chat
          can add named people or children.
        </Text>
        <Field
          label="Your artists (optional, separated by commas)"
          value={artists}
          onChangeText={setArtists}
          placeholder="Amaarae, Sade"
        />
        {deck.length > 0 && (
          <>
            <Text style={styles.label}>Your tastes, if you like</Text>
            <View style={styles.wrap}>
              {deck.slice(0, 18).map((card) => (
                <Chip
                  key={card.id}
                  label={card.label}
                  selected={brief.people[0].vibes.includes(card.id)}
                  onPress={() => {
                    const person = brief.people[0],
                      selected = person.vibes.includes(card.id);
                    if (!selected && person.vibes.length >= 18) {
                      setError("Choose up to eighteen tastes.");
                      return;
                    }
                    update({
                      people: [
                        {
                          ...person,
                          vibes: selected
                            ? person.vibes.filter((id) => id !== card.id)
                            : [...person.vibes, card.id],
                        },
                        ...brief.people.slice(1),
                      ],
                    });
                  }}
                />
              ))}
            </View>
          </>
        )}
        <Field
          label="Total allowance for everyone (optional)"
          value={budget}
          onChangeText={setBudget}
          placeholder="Leave open"
          numeric
        />
        <Field
          label="Currency"
          value={brief.currency}
          onChangeText={(value) =>
            update({
              currency: value.toUpperCase().slice(0, 3),
              currencyMode: "custom",
            })
          }
        />
        <Text style={styles.small}>
          An allowance, not a venue price or a currency conversion.
        </Text>
        <Field
          label="Date (optional)"
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD"
        />
        <View style={styles.wrap}>
          <Chip
            label="Flexible time"
            selected={!brief.timing.timeConfirmed}
            onPress={() =>
              update({
                timing: {
                  ...brief.timing,
                  timeConfirmed: false,
                  mode: "flexible",
                },
              })
            }
          />
          <Chip
            label="Set a time window"
            selected={brief.timing.timeConfirmed}
            onPress={() =>
              update({
                timing: { ...brief.timing, timeConfirmed: true, mode: "fixed" },
              })
            }
          />
        </View>
        {brief.timing.timeConfirmed && (
          <>
            <Field
              label="Start time"
              value={brief.startTime}
              onChangeText={(startTime) => update({ startTime })}
              placeholder="17:00"
            />
            <Field
              label="Finish by"
              value={brief.endTime}
              onChangeText={(endTime) => update({ endTime })}
              placeholder="22:00"
            />
          </>
        )}
        <View style={styles.wrap}>
          <Chip
            label="Take it easy"
            selected={brief.pace === "easy"}
            onPress={() => update({ pace: "easy" })}
          />
          <Chip
            label="A little more pace"
            selected={brief.pace === "balanced"}
            onPress={() => update({ pace: "balanced" })}
          />
        </View>
        {!!error && <Note text={error} error />}
        <Button
          label={draft.confirmed ? "Find my places" : "Choose an area"}
          icon="arrow-forward"
          onPress={submit}
        />
        <Text style={styles.small}>
          Your brief goes to Unstressed. Chat uses its configured model; places
          and taste evidence come from Qloo.
        </Text>
      </ScrollView>
    </Sheet>
  );
}

function StopCard({
  stop,
  index,
  edit,
  provisional,
}: {
  stop: Stop;
  index: number;
  edit: () => void;
  provisional?: boolean;
}) {
  const imageUrl = venueDetailsData(stop.item).imageUrl;
  const [failedImage, setFailedImage] = useState<string | null>(null);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Visit ${index + 1}, ${stop.item?.name || "unfilled"}, view details and edits`}
      disabled={provisional}
      onPress={edit}
      style={styles.stopCard}
    >
      <View style={styles.row}>
        <View style={styles.stopNumber}>
          <Text style={styles.numberText}>
            {String(index + 1).padStart(2, "0")}
          </Text>
        </View>
        <Text style={[styles.eyebrow, styles.flex]}>
          {activityLabels[stop.intent]}
        </Text>
        <Icon name={icons[stop.intent]} />
      </View>
      {!!imageUrl && failedImage !== imageUrl && (
        <Image
          source={{ uri: imageUrl }}
          style={styles.stopImage}
          resizeMode="cover"
          accessibilityLabel={`Provider photo of ${stop.item?.name || "this venue"}`}
          onError={() => setFailedImage(imageUrl)}
        />
      )}
      <Text style={styles.stopTitle}>
        {stop.item?.name || "A little room to explore"}
      </Text>
      <Text style={styles.body}>
        {stop.item?.address ||
          (stop.item
            ? "Address not supplied"
            : stop.unfilledReason ||
              "No qualifying place returned for this visit.")}
      </Text>
      <View style={styles.cardFooter}>
        <Text style={styles.small}>
          {stop.start && stop.end
            ? `${stop.start}–${stop.end} · suggested`
            : "Timing is still open"}
        </Text>
        <Icon name="arrow-forward" size={18} />
      </View>
    </Pressable>
  );
}

function Planner() {
  const [draft, setDraft] = useState<Draft>(initial),
    [loaded, setLoaded] = useState(false),
    [messages, setMessages] = useState<Message[]>([]),
    [text, setText] = useState(""),
    [tab, setTab] = useState<"chat" | "day" | "ready">("chat");
  const [section, setSection] = useState<"plan" | "saved" | "circles" | "account">("plan");
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [accountState, setAccountState] = useState(accountSession.getSnapshot());
  const [sheet, setSheet] = useState<"location" | "review" | "about" | null>(
      null,
    ),
    [locationQuery, setLocationQuery] = useState(""),
    [selected, setSelected] = useState<number | null>(null),
    [busy, setBusy] = useState(""),
    [preview, setPreview] = useState<Plan | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [saveError, setSaveError] = useState(""),
    [undo, setUndo] = useState<Draft | null>(null);
  const gate = useRef(createRequestGate()),
    current = useRef(draft),
    scroll = useRef<React.ComponentRef<typeof ScrollView>>(null),
    mounted = useRef(true),
    restored = useRef(false);
  current.current = draft;
  function append(message: string, role: Message["role"] = "assistant") {
    if (typeof message !== "string" || message.length > 10000)
      throw new Error(
        "The chat response is incomplete. Please retry or use Review plan.",
      );
    setMessages((previous) =>
      [...previous, { role, text: message }].slice(-40),
    );
  }
  function cancel(showNotice = true) {
    gate.current.invalidate();
    setBusy("");
    setPreview(null);
    if (showNotice)
      setNotice("Stopped. Your last completed plan and draft are kept.");
  }
  function updateDraft(next: Draft) {
    if (!isBrief(next.brief))
      throw new Error(
        "The proposed details are incomplete. Review your plan to continue.",
      );
    gate.current.invalidate();
    current.current = next;
    setDraft(next);
    setPreview(null);
    setBusy("");
    setError("");
  }
  useEffect(() => {
    mounted.current = true;
    disk
      .load()
      .then((value) => {
        if (mounted.current && value && !accountWorkspace.isPrivate()) {
          current.current = value as Draft;
          setDraft(value as Draft);
          setNotice(
            "Your last draft is back. Saved places are a snapshot; refresh before you go.",
          );
          restored.current = true;
        }
      })
      .catch((error) => {
        if (mounted.current) {
          restored.current = true;
          setSaveError(error.message);
        }
      })
      .finally(() => {
        if (mounted.current) setLoaded(true);
      });
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        gate.current.invalidate();
        setBusy("");
        setPreview(null);
      }
    });
    return () => {
      mounted.current = false;
      gate.current.invalidate();
      subscription.remove();
    };
  }, []);
  useEffect(() => accountSession.subscribe((next: ReturnType<typeof accountSession.getSnapshot>) => {
    const identity = next.signedIn ? `${next.userId}:${next.sessionEpoch}` : null;
    const before = accountWorkspace.isPrivate();
    const guest = accountWorkspace.switchIdentity(identity, current.current);
    setAccountState(next);
    if (guest || before !== accountWorkspace.isPrivate()) {
      gate.current.invalidate();
      setBusy(""); setPreview(null); setUndo(null); setMessages([]); setText(""); setSelected(null); setSheet(null); setLocationQuery("");
      if (guest) { current.current = guest as Draft; setDraft(guest as Draft); }
      setNotice(next.signedIn ? "Account connected. Plans you make now are saved to your account. This working draft stays in memory." : "Signed out. Your device draft is back; account details are cleared.");
    }
  }), []);
  useEffect(() => {
    if (!loaded || accountWorkspace.isPrivate()) return;
    if (restored.current) {
      restored.current = false;
      return;
    }
    disk
      .save(draft)
      .then(() => {
        if (mounted.current) setSaveError("");
      })
      .catch((error) => {
        if (mounted.current) setSaveError(`Draft not saved: ${error.message}`);
      });
  }, [draft, loaded]);
  function accept(plan: Plan, previous: Draft) {
    requirePlan(plan);
    accountWorkspace.remember(plan);
    setUndo(previous.plan ? previous : null);
    const next = {
      brief: plan.request,
      confirmed: true,
      plan,
      planningTimeZone: plan.timeZone || previous.planningTimeZone,
    };
    current.current = next;
    setDraft(next);
    setPreview(null);
    setTab("day");
    if (plan.saveError) setNotice(plan.saveError);
    else if (plan.savedPlan) setNotice("Saved to your account. Account drafts stay in memory; Save copy creates a separate device copy.");
    append(
      plan.status === "partial"
        ? "Here’s what I found. Any unfilled visits stay visible, without substituting places."
        : "Your places are here. Take a look, then make the day your own.",
    );
  }
  async function build(brief: Brief) {
    if (!isBrief(brief)) {
      setError(
        "The proposed details are incomplete. Review your plan to continue.",
      );
      setBusy("");
      return;
    }
    if (!current.current.confirmed) {
      updateDraft({ ...current.current, brief });
      setSheet("location");
      return;
    }
    if (!brief.activities.length) {
      setSheet("review");
      return;
    }
    const previous = current.current;
    const job = gate.current.begin();
    setSheet(null);
    setSelected(null);
    setError("");
    setNotice("");
    setBusy("Finding places");
    setPreview(null);
    setTab("day");
    // Save the requested brief even if the network is interrupted, while keeping
    // the old result separately. It is visibly marked as an older snapshot.
    current.current = { ...previous, brief };
    setDraft(current.current);
    try {
      const plan = await api.itinerary(brief, {
        signal: job.signal,
        onDiscovery: (plan: Plan) => {
          if (job.current()) {
            setPreview(requirePlan(plan));
            setBusy("Checking your places");
          }
        },
      });
      if (job.current()) accept(plan, previous);
    } catch (error) {
      if (job.current()) {
        setPreview(null);
        setError(
          error instanceof Error
            ? error.message
            : "Could not connect. Your previous plan is kept.",
        );
      }
    } finally {
      if (job.current()) setBusy("");
    }
  }
  async function send() {
    const message = text.trim();
    if (!message || busy || !loaded) return;
    const previous = current.current,
      job = gate.current.begin();
    const history = messages
      .slice(-8)
      .map((value) => ({ ...value, text: value.text.slice(0, 1600) }));
    append(message, "user");
    setText("");
    setError("");
    setNotice("");
    setBusy("Thinking with you");
    try {
      let savedCircles: {
        id: string;
        name: string;
        people: Brief["people"];
      }[] = [];
      try {
        const stored = await library.load();
        savedCircles = stored.circles
          .filter((circle: { removedAt?: string }) => !circle.removedAt)
          .map(
            (circle: {
              id: string;
              name: string;
              people: Brief["people"];
            }) => ({ id: circle.id, name: circle.name, people: circle.people }),
          );
      } catch {
        setNotice(
          "Saved circles could not be loaded. This conversation can still use the people in your current draft.",
        );
      }
      if (!job.current()) return;
      if (accountSession.getSnapshot().signedIn) {
        const connected = await accountSession.account();
        if (!job.current()) return;
        savedCircles = connected.circles || [];
      }
      const result = await api.agent(
        {
          message,
          circles: savedCircles,
          context: previous.brief,
          history,
          mode: "guided",
          locationContext: {
            confirmed: previous.confirmed,
            timeZone: destinationTimeZone(previous),
          },
          ...(previous.plan &&
          JSON.stringify(previous.plan.request) ===
            JSON.stringify(previous.brief)
            ? { planContext: planContext(previous.plan) }
            : {}),
        },
        job.signal,
      );
      if (!job.current()) return;
      if (result.request && !isBrief(result.request))
        throw new Error(
          "The proposed details are incomplete. Review your plan to continue.",
        );
      if (result.request && Array.isArray(result.stops))
        accept(result, previous);
      else if (result.status === "ready") {
        await build(result.request);
      } else if (result.status === "needs_input") append(result.question);
      else if (result.status === "reply") append(result.text);
      else if (result.status === "action") {
        if (result.action === "set_location") {
          updateDraft({
            ...previous,
            brief: result.request,
            confirmed: false,
            planningTimeZone: undefined,
          });
          setLocationQuery(result.query || "");
          setSheet("location");
          append(
            result.assistantMessage ||
              "Choose the exact area below. Then we’ll return to your day.",
          );
        } else if (result.action === "bring_circle") {
          const circle = savedCircles.find(
            (value) => value.id === result.circleId,
          );
          if (!circle)
            throw new Error(
              "That circle is no longer saved. Choose a circle from the Circles tab.",
            );
          applyCircle(applyCircleToBrief(previous.brief, circle) as Brief);
        } else if (result.action === "select_places")
          await build(groundedRoute(previous.plan, result) as Brief);
        else if (["choose_activities", "set_timing"].includes(result.action)) {
          updateDraft({ ...previous, brief: result.request });
          setSheet("review");
          append("Review these details before finding your places.");
        } else if (
          ["add_person", "update_person", "remove_person"].includes(
            result.action,
          )
        ) {
          let people = previous.brief.people;
          if (result.action === "add_person")
            people = [...people, personWithId(result.person, people)];
          if (result.action === "update_person")
            people = people.map((person) =>
              person.id === result.person.id ? result.person : person,
            );
          if (result.action === "remove_person")
            people = people.filter((person) => person.id !== result.personId);
          if (!people.length || people.length > 6)
            throw new Error("Keep one to six taste profiles in this day.");
          updateDraft({
            ...previous,
            brief: {
              ...previous.brief,
              people,
              party: {
                ...previous.brief.party,
                adults: Math.max(
                  previous.brief.party.adults,
                  people.length - previous.brief.party.children,
                ),
              },
            },
          });
          append(
            "The people in your draft are updated. Review the plan to find places with these tastes.",
          );
          setSheet("review");
        } else
          append(
            "Device groups are in Circles. Open Account for cloud circles, saved plans and invitations.",
          );
      } else if (result.status === "show_ui") {
        if (result.request) updateDraft({ ...previous, brief: result.request });
        if (result.panel === "location") {
          setLocationQuery("");
          setSheet("location");
        } else if (
          ["tastes", "budget", "timing", "review"].includes(result.panel)
        )
          setSheet("review");
        else if (result.panel === "circles" || result.panel === "people") {
          setSection(accountSession.getSnapshot().signedIn ? "account" : "circles");
          append("Your circles are here. Account circles and device circles are kept separately.");
        } else if (
          ["checks", "routes", "menus", "bookings"].includes(result.panel)
        ) {
          setTab("ready");
          append(
            "Get ready has reported-hours checks, journey links and venue enquiry preparation. Choose a place to see its evidence and contact options.",
          );
        } else if (["itinerary", "compare"].includes(result.panel)) {
          setTab("day");
          append(
            "Open a visit for its evidence, alternatives and Maps link. Prices, current hours and availability still need confirmation.",
          );
        } else if (["account", "saved", "invitations"].includes(result.panel)) {
          setSection("account");
        } else append("Open Account for cloud plans and invitations, or Saved for your device copies.");
      } else
        throw new Error(
          "This response is not supported yet. Review your plan to continue.",
        );
    } catch (error) {
      if (job.current()) {
        setText(message);
        setError(
          error instanceof Error
            ? error.message
            : "Chat could not connect. You can still use Review plan.",
        );
      }
    } finally {
      if (job.current()) setBusy("");
    }
  }
  function reviseStop(
    index: number,
    operation: string,
    replacementId?: string,
  ) {
    try {
      void build(
        editStop(
          current.current.plan,
          index,
          operation,
          replacementId,
        ) as Brief,
      );
    } catch (error) {
      setSelected(null);
      setError(
        error instanceof Error
          ? error.message
          : "That visit could not be edited.",
      );
    }
  }
  function openSavedOuting(saved: Draft) {
    Alert.alert(
      "Open this saved outing?",
      "This replaces your current draft. Your saved copies are kept.",
      [
        { text: "Keep current draft", style: "cancel" },
        {
          text: "Open outing",
          onPress: () => {
            cancel(false);
            accountWorkspace.clearTarget();
            updateDraft(saved);
            setUndo(null);
            setMessages([]);
            setText("");
            setSelected(null);
            setSheet(null);
            setSection("plan");
            setTab(saved.plan ? "day" : "chat");
            setNotice(
              "Saved outing opened. Places are a snapshot; check details before you go.",
            );
          },
        },
      ],
    );
  }
  function applyCircle(brief: Brief) {
    updateDraft({ ...current.current, brief });
    setSection("plan");
    setTab("chat");
    append(
      "Your circle is in this draft. Review the people and tastes, then find places when you’re ready.",
    );
    setNotice(
      "Circle applied to this outing. Any earlier result stays unchanged until you search again.",
    );
  }
  function openAccountPlan(plan: Plan, options?: { editable?: boolean }) {
    requirePlan(plan);
    const opening = accountSession.getSnapshot();
    Alert.alert("Open this account plan?", "This replaces the working draft. It stays in memory while signed in; your device draft is kept separately.", [
      { text: "Keep current draft", style: "cancel" },
      { text: "Open plan", onPress: () => {
        const active = accountSession.getSnapshot();
        if (!active.signedIn || active.userId !== opening.userId || active.sessionEpoch !== opening.sessionEpoch) return;
        cancel(false); accountWorkspace.remember(plan, options?.editable !== false);
        updateDraft({ brief: plan.request, confirmed: true, plan, planningTimeZone: plan.timeZone });
        setUndo(null); setMessages([]); setText(""); setSection("plan"); setTab("day");
        setNotice(options?.editable === false ? "Circle plan opened as a read-only snapshot. Replanning creates a new private copy in your account." : "Account plan opened. Edits save a new revision; newer server changes are protected.");
      } },
    ]);
  }
  function navigateSection(value: "plan" | "saved" | "circles" | "account") {
    if (busy) return;
    Keyboard.dismiss();
    setSelected(null);
    setSheet(null);
    setSection(value);
  }
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  function newOuting() {
    Alert.alert(
      "Start a fresh outing?",
      "This clears the current draft and conversation. Saved outings and circles are kept.",
      [
        { text: "Keep this day", style: "cancel" },
        {
          text: "Start fresh",
          style: "destructive",
          onPress: () => {
            cancel(false);
            setUndo(null);
            setMessages([]);
            setText("");
            setSelected(null);
            setSection("plan");
            setTab("chat");
            setSheet(null);
            const next = {
              brief: newBrief() as Brief,
              confirmed: false,
              plan: null,
            };
            accountWorkspace.clearTarget();
            updateDraft(next);
            if (!accountWorkspace.isPrivate()) disk.clear().catch((error) => setSaveError(error.message));
            setNotice("A fresh start. What would make a good day?");
          },
        },
      ],
    );
  }
  const plan = preview || draft.plan;
  const dirty =
    !!draft.plan &&
    JSON.stringify(draft.brief) !== JSON.stringify(draft.plan.request);
  const stop = selected === null ? null : draft.plan?.stops[selected];
  if (!loaded)
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.loading}>
          <ActivityIndicator color={palette.ink} />
          <Text style={styles.body}>Making room for your day…</Text>
        </View>
      </SafeAreaView>
    );
  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.header}>
          <View style={styles.brandMark}>
            <BrandMark size={40} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.brand}>unstressed.</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Account and app information"
            onPress={() => setSheet("about")}
            style={styles.iconButton}
          >
            <Icon name="ellipsis-horizontal" />
          </Pressable>
        </View>
        {section === "plan" ? (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                cancel(false);
                setLocationQuery("");
                setSheet("location");
              }}
              style={styles.locationBar}
            >
              <Icon name="location-outline" size={17} />
              <Text
                numberOfLines={2}
                style={[styles.locationText, styles.flex]}
              >
                {draft.confirmed
                  ? draft.brief.area
                  : "Choose your corner of the world"}
              </Text>
              <Icon name="chevron-down" size={17} />
            </Pressable>
            <View style={styles.tabs}>
              {(["chat", "day", "ready"] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === value }}
                  onPress={() => setTab(value)}
                  style={[styles.tab, tab === value && styles.tabActive]}
                >
                  <Icon
                    name={
                      value === "chat"
                        ? "chatbubble-ellipses-outline"
                        : value === "day"
                          ? "trail-sign-outline"
                          : "checkmark-circle-outline"
                    }
                    size={18}
                  />
                  <Text style={styles.tabLabel}>
                    {value === "chat"
                      ? "Let’s plan"
                      : value === "ready"
                        ? "Get ready"
                        : `Your day${plan ? ` · ${plan.stops.filter((stop) => stop.item).length}` : ""}`}
                  </Text>
                </Pressable>
              ))}
            </View>
            <ScrollView
              ref={scroll}
              style={styles.flex}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => {
                if (tab === "chat" && messages.length)
                  scroll.current?.scrollToEnd({ animated: true });
              }}
            >
              {tab === "chat" ? (
                <>
                  {!messages.length && (
                    <View style={styles.hero}>
                      <View style={styles.heroSun}>
                        <BrandMark size={60} />
                      </View>
                      <Text style={styles.eyebrow}>
                        A GOOD DAY STARTS SMALL
                      </Text>
                      <Text accessibilityRole="header" style={styles.heroTitle}>
                        Less figuring out.{"\n"}More heading out.
                      </Text>
                      <Text style={styles.heroText}>
                        A place to pause, something new, or an evening with your
                        people. What are you in the mood for?
                      </Text>
                      <View style={styles.suggestions}>
                        {[
                          "A quiet place to sit after work",
                          "Friday with friends, starting in East Legon",
                        ].map((suggestion) => (
                          <Pressable
                            key={suggestion}
                            accessibilityRole="button"
                            onPress={() => setText(suggestion)}
                            style={styles.suggestion}
                          >
                            <Text style={[styles.body, styles.flex]}>
                              {suggestion}
                            </Text>
                            <Icon name="arrow-up-outline" size={18} />
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  )}
                  {messages.map((message, index) => (
                    <View
                      key={index}
                      style={[
                        styles.message,
                        message.role === "user"
                          ? styles.userMessage
                          : styles.assistantMessage,
                      ]}
                    >
                      {message.role === "assistant" && (
                        <View style={styles.assistantIdentity}>
                          <BrandMark size={22} />
                          <Text style={styles.messageFrom}>unstressed.</Text>
                        </View>
                      )}
                      <Text
                        selectable
                        style={[
                          styles.messageText,
                          message.role === "user" && { color: palette.white },
                        ]}
                      >
                        {message.text}
                      </Text>
                    </View>
                  ))}
                  {draft.plan && (
                    <Button
                      quiet
                      icon="trail-sign-outline"
                      label="See your places"
                      onPress={() => setTab("day")}
                    />
                  )}
                </>
              ) : tab === "ready" ? (
                plan && !preview ? (
                  <>
                    {dirty && (
                      <Note text="These details belong to your previous result. Find places again to apply the current draft." />
                    )}
                    <DayReadiness
                      key={JSON.stringify([
                        plan.request,
                        plan.stops.map((visit) => [visit.id, visit.item?.id]),
                      ])}
                      plan={plan}
                      onError={setError}
                      onOpenStop={
                        !dirty && !busy
                          ? (visit) => {
                              const index = draft.plan!.stops.indexOf(visit);
                              if (index >= 0) setSelected(index);
                            }
                          : undefined
                      }
                    />
                  </>
                ) : (
                  <View style={styles.empty}>
                    <Text style={styles.dayTitle}>
                      A little preparation. A better day.
                    </Text>
                    <Text style={styles.heroText}>
                      Once your places are ready, check reported hours, plan the
                      journey and prepare venue enquiries here.
                    </Text>
                    <Button
                      label="Plan an outing"
                      onPress={() => {
                        setTab("chat");
                        if (!busy) setSheet("review");
                      }}
                    />
                  </View>
                )
              ) : (
                <>
                  {plan ? (
                    <>
                      <View style={styles.dayHeading}>
                        <Text style={styles.eyebrow}>
                          {preview
                            ? "FIRST LOOK · REVIEW IN PROGRESS"
                            : dirty
                              ? "PREVIOUS RESULT · DRAFT CHANGED"
                              : "YOUR DAY, WITH ROOM TO BREATHE"}
                        </Text>
                        <Text
                          accessibilityRole="header"
                          style={styles.dayTitle}
                        >
                          {planTitle(plan.request)}
                        </Text>
                        <Text style={styles.body}>
                          {plan.request.party.adults +
                            plan.request.party.children}{" "}
                          people ·{" "}
                          {plan.request.timing.dateConfirmed
                            ? plan.request.date
                            : "Date open"}{" "}
                          ·{" "}
                          {plan.request.budget === null
                            ? "Allowance open"
                            : `${plan.request.currency} ${plan.request.budget} allowance`}
                        </Text>
                      </View>
                      {dirty && !preview && (
                        <View style={styles.noticeCard}>
                          <Text style={styles.body}>
                            These places belong to your previous brief. Find
                            places again to apply your changes.
                          </Text>
                          <Button
                            quiet
                            label="Find places for this draft"
                            disabled={!!busy}
                            onPress={() => build(draft.brief)}
                          />
                        </View>
                      )}
                      {plan.stops.map((stop, index) => (
                        <StopCard
                          key={`${stop.id || index}-${index}`}
                          stop={stop}
                          index={index}
                          provisional={!!preview || !!busy || dirty}
                          edit={() => setSelected(index)}
                        />
                      ))}
                      {!preview && (
                        <Button
                          quiet
                          icon="checkmark-circle-outline"
                          label="Get ready for this outing"
                          onPress={() => setTab("ready")}
                        />
                      )}
                      <View style={styles.evidence}>
                        <Icon name="shield-checkmark-outline" size={18} />
                        <Text style={[styles.small, styles.flex]}>
                          Places returned by the existing planner. Times are
                          suggestions, allowances are not prices, and current
                          hours, accessibility and availability need checking.
                        </Text>
                      </View>
                      {plan.warnings?.slice(0, 6).map((warning, index) => (
                        <Note key={index} text={warning} />
                      ))}
                      {undo && !busy && (
                        <Button
                          quiet
                          icon="arrow-undo-outline"
                          label="Undo last plan change"
                          onPress={() => {
                            const old = undo;
                            setUndo(null);
                            updateDraft(old);
                            setNotice(
                              "The previous completed plan is restored.",
                            );
                          }}
                        />
                      )}
                      {!busy && (
                        <Button
                          quiet
                          icon="refresh-outline"
                          label="Refresh these places"
                          onPress={() => build(draft.brief)}
                        />
                      )}
                    </>
                  ) : (
                    <View style={styles.empty}>
                      <View style={styles.heroSun}>
                        <Icon name="trail-sign-outline" size={32} />
                      </View>
                      <Text style={styles.dayTitle}>
                        A day with possibilities.
                      </Text>
                      <Text style={styles.heroText}>
                        Tell me what you have in mind, or shape a simple plan
                        below. Real places appear here when the search returns.
                      </Text>
                      <Button
                        label="Shape my day"
                        onPress={() => setSheet("review")}
                      />
                    </View>
                  )}
                </>
              )}
              {!!notice && <Note text={notice} />}
              {!!saveError && <Note text={saveError} error />}
              {!!error && (
                <View style={styles.errorBox}>
                  <Note text={error} error />
                  <Text style={styles.small}>
                    Your draft and last completed places are kept. You can retry
                    or use Review plan.
                  </Text>
                </View>
              )}
            </ScrollView>
            <View style={styles.composerDock}>
              {!!busy && (
                <View style={styles.busyRow}>
                  <ActivityIndicator size="small" color={palette.ink} />
                  <Text
                    accessibilityLiveRegion="polite"
                    style={[styles.small, styles.flex]}
                  >
                    {busy}…
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => cancel()}
                    style={styles.cancel}
                  >
                    <Text style={styles.linkText}>Stop</Text>
                  </Pressable>
                </View>
              )}
              <View style={styles.toolbar}>
                <Chip
                  label="Review plan"
                  icon="options-outline"
                  disabled={!!busy}
                  onPress={() => setSheet("review")}
                />
                <Text
                  style={[styles.small, styles.flex, { textAlign: "right" }]}
                >
                  {accountState.signedIn ? "Chat uses your account circles" : "Chat uses your draft & saved circles"}
                </Text>
              </View>
              <View style={styles.composer}>
                <TextInput
                  accessibilityLabel="Message Unstressed"
                  value={text}
                  onChangeText={setText}
                  placeholder="What would make a good day?"
                  placeholderTextColor={palette.muted}
                  multiline
                  maxLength={1600}
                  editable={!busy}
                  style={styles.messageInput}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Send message"
                  accessibilityState={{ disabled: !!busy || !text.trim() }}
                  disabled={!!busy || !text.trim()}
                  onPress={send}
                  style={[
                    styles.sendButton,
                    (!!busy || !text.trim()) && styles.disabled,
                  ]}
                >
                  <Icon name="arrow-up" color={palette.white} size={22} />
                </Pressable>
              </View>
            </View>
          </>
        ) : section === "saved" ? (
          <SavedPlansScreen currentDraft={draft} onOpen={openSavedOuting} />
        ) : section === "circles" ? (
          <CirclesScreen currentDraft={draft} onApply={applyCircle} />
        ) : (
          <NativeAccountScreen session={accountSession} onOpenPlan={openAccountPlan}
            onImportCircle={(circle) => applyCircle(applyCircleToBrief(current.current.brief, circle) as Brief)} />
        )}
        {!keyboardVisible && (
          <View style={styles.mainNav}>
            {(
              [
                { value: "plan", label: "Plan", icon: "sparkles-outline" },
                { value: "saved", label: "Saved", icon: "bookmark-outline" },
                { value: "circles", label: "Circles", icon: "people-outline" },
                { value: "account", label: "Account", icon: accountState.signedIn ? "person-circle" : "person-circle-outline" },
              ] as const
            ).map((item) => (
              <Pressable
                key={item.value}
                accessibilityRole="tab"
                accessibilityLabel={item.label}
                accessibilityState={{
                  selected: section === item.value,
                  disabled: !!busy,
                }}
                disabled={!!busy}
                onPress={() => navigateSection(item.value)}
                style={[
                  styles.mainNavItem,
                  section === item.value && styles.mainNavActive,
                  !!busy && styles.disabled,
                ]}
              >
                <Icon name={item.icon} size={21} />
                <Text style={styles.mainNavLabel}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </KeyboardAvoidingView>
      {sheet === "location" && (
        <LocationSheet
          query={locationQuery}
          close={() => setSheet(null)}
          choose={(area) => {
            const before = current.current.brief;
            const next = confirmArea(before, area) as Brief;
            updateDraft({
              ...current.current,
              brief: next,
              confirmed: true,
              planningTimeZone: area.timeZone,
            });
            setSheet(null);
            setTab("chat");
            append(
              `${area.label} is set for this outing.${before.budget !== null && next.budget === null ? " The allowance is cleared so you can review it in the local currency." : ""} Review the details when you’re ready to find places.${!area.currency ? " Local currency was not supplied; check it in Review plan." : ""}`,
            );
          }}
        />
      )}
      {sheet === "review" && (
        <ReviewSheet
          draft={draft}
          close={() => setSheet(null)}
          apply={(brief) => build(brief)}
        />
      )}
      {sheet === "about" && (
        <Sheet title="A calmer way out" close={() => setSheet(null)}>
          <ScrollView contentContainerStyle={styles.sheetBody}>
            <Text style={styles.body}>
              Plan real outings, save days and keep reusable circles on this
              device. Chat sends your draft and saved circle profiles to
              Unstressed and its configured model for planning. Local storage is
              not encrypted by the app; chat is not saved after restart.
            </Text>
            <Text style={styles.body}>
              Account sign-in uses your browser and an explicit device approval.
              Account plans stay in memory while signed in; device copies are separate.
              No web cookie or native session token is saved on this device.
            </Text>
            <Text style={styles.small}>
              Getting ready can check provider-reported details and prepare an
              enquiry for you to review. Nothing is sent, booked or paid for.
              External Maps and contact options open only when you choose them.
            </Text>
            <Button label="Open your account" icon="person-circle-outline" onPress={() => navigateSection("account")} />
            <Button
              quiet
              label="Open account features on the web"
              icon="open-outline"
              onPress={() =>
                Linking.openURL("https://unstressed.serendepify.com").catch(
                  () => setError("Could not open the web app."),
                )
              }
            />
            <Button
              quiet
              label="Start a fresh outing"
              icon="refresh-outline"
              onPress={newOuting}
            />
          </ScrollView>
        </Sheet>
      )}
      {stop && selected !== null && (
        <Sheet title={`Visit ${selected + 1}`} close={() => setSelected(null)}>
          <ScrollView contentContainerStyle={styles.sheetBody}>
            <Text style={styles.dayTitle}>
              {stop.item?.name || "An open visit"}
            </Text>
            <Text style={styles.body}>
              {stop.item?.address || "Address not supplied."}
            </Text>
            <VenueDetails
              key={`${stop.id}-${stop.item?.id}`}
              stop={stop}
              plan={draft.plan!}
              onError={setError}
            />
            <Text style={styles.label}>Make it your day</Text>
            <Button
              quiet
              icon="shuffle-outline"
              label="Find another place for this visit"
              onPress={() => reviseStop(selected, "swap")}
            />
            {selected > 0 && (
              <Button
                quiet
                icon="arrow-up-outline"
                label="Move this visit earlier"
                onPress={() => reviseStop(selected, "up")}
              />
            )}
            {draft.plan!.stops.length > 1 && (
              <Button
                quiet
                icon="remove-circle-outline"
                label="Remove this visit"
                onPress={() => reviseStop(selected, "remove")}
              />
            )}
            {!!stop.alternatives?.length && (
              <Text style={styles.label}>
                Other places returned for this stop
              </Text>
            )}
            {stop.alternatives?.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Choose ${item.name} instead`}
                onPress={() => reviseStop(selected, "replace", item.id)}
                style={styles.areaRow}
              >
                <View style={styles.flex}>
                  <Text style={styles.itemTitle}>{item.name}</Text>
                  <Text style={styles.small}>
                    {item.address || "Address not supplied"}
                  </Text>
                </View>
                <Icon name="arrow-forward" />
              </Pressable>
            ))}
            <Text style={styles.small}>
              Untouched visits are kept. Every change is checked again by the
              server before it replaces your plan.
            </Text>
          </ScrollView>
        </Sheet>
      )}
    </SafeAreaView>
  );
}
export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });
  return (
    <SafeAreaProvider>
      {fontsLoaded || fontError ? (
        <Planner />
      ) : (
        <SafeAreaView style={styles.screen}>
          <View style={styles.loading}>
            <BrandMark size={64} />
            <ActivityIndicator
              color={palette.ink}
              accessibilityLabel="Loading Unstressed"
            />
          </View>
        </SafeAreaView>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stopImage: {
    width: "100%",
    height: 170,
    borderRadius: 15,
    backgroundColor: palette.green,
  },
  mainNav: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.paper,
  },
  mainNavItem: {
    flex: 1,
    minHeight: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: 5,
  },
  mainNavActive: { backgroundColor: palette.green },
  mainNavLabel: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 12,
    lineHeight: 16,
    color: palette.ink,
  },
  screen: { flex: 1, backgroundColor: palette.paper },
  loading: { flex: 1, gap: 20, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 18,
  },
  assistantIdentity: { flexDirection: "row", alignItems: "center", gap: 6 },
  brandMark: {
    height: 42,
    width: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    fontFamily: "Manrope_500Medium",
    fontSize: 25,
    color: palette.ink,
    letterSpacing: -1,

    lineHeight: 32,
  },
  brandSub: {
    fontFamily: "Manrope_400Regular",
    fontSize: 13,
    color: palette.muted,
    marginTop: 1,
    lineHeight: 18,
  },
  iconButton: {
    minHeight: 48,
    minWidth: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  locationBar: {
    marginHorizontal: 20,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 15,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  locationText: {
    fontFamily: "Manrope_500Medium",
    fontSize: 15,
    color: palette.ink,
    lineHeight: 20,
  },
  tabs: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginTop: 14,
    marginBottom: 3,
    backgroundColor: palette.paper,
    borderRadius: 15,
    padding: 4,
  },
  tab: {
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    flex: 1,
    minHeight: 48,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  tabActive: { backgroundColor: palette.paper, borderBottomColor: palette.ink },
  tabLabel: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 15,
    color: palette.ink,
    lineHeight: 20,
  },
  content: { padding: 20, gap: 14, paddingBottom: 28 },
  hero: { paddingTop: 16, gap: 15 },
  heroSun: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 5,
  },
  eyebrow: {
    fontFamily: "Manrope_700Bold",
    fontSize: 11,
    letterSpacing: 1.6,
    color: palette.muted,

    lineHeight: 16,
  },
  heroTitle: {
    fontFamily: "Manrope_500Medium",
    fontSize: 36,
    lineHeight: 42,
    letterSpacing: -1.4,
    color: palette.ink,
  },
  heroText: {
    fontFamily: "Manrope_400Regular",
    fontSize: 16,
    lineHeight: 24,
    color: palette.muted,
  },
  suggestions: { gap: 10, marginTop: 9 },
  suggestion: {
    flexDirection: "row",
    gap: 12,
    padding: 15,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 15,
    backgroundColor: palette.white,
    alignItems: "center",
  },
  body: {
    fontFamily: "Manrope_400Regular",
    fontSize: 16,
    lineHeight: 24,
    color: palette.ink,
  },
  small: {
    fontFamily: "Manrope_400Regular",
    fontSize: 13,
    lineHeight: 18,
    color: palette.muted,
  },
  button: {
    minHeight: 50,
    borderRadius: 15,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 17,
    paddingVertical: 13,
  },
  buttonText: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 15,
    color: palette.white,
    flexShrink: 1,
    textAlign: "center",

    lineHeight: 20,
  },
  quietButton: { backgroundColor: "#E9EEDC" },
  quietText: { color: palette.ink },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
  chip: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.white,
    borderRadius: 22,
  },
  chipSelected: { backgroundColor: palette.green, borderColor: palette.accent },
  chipText: {
    fontFamily: "Manrope_500Medium",
    fontSize: 14,
    color: palette.ink,
    lineHeight: 20,
  },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  message: { maxWidth: "94%", borderRadius: 20, padding: 16, gap: 5 },
  userMessage: {
    backgroundColor: palette.ink,
    alignSelf: "flex-end",
    borderBottomRightRadius: 5,
  },
  assistantMessage: {
    backgroundColor: palette.white,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: palette.line,
    borderBottomLeftRadius: 5,
  },
  messageFrom: {
    fontFamily: "Manrope_700Bold",
    fontSize: 13,
    letterSpacing: 0.7,
    color: palette.muted,

    lineHeight: 18,
  },
  messageText: {
    fontFamily: "Manrope_400Regular",
    fontSize: 16,
    lineHeight: 24,
    color: palette.ink,
  },
  composerDock: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 9,
    borderTopWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.paper,
  },
  toolbar: { flexDirection: "row", alignItems: "center", gap: 12 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 7,
    paddingLeft: 13,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 23,
    backgroundColor: palette.white,
  },
  messageInput: {
    fontFamily: "Manrope_400Regular",
    flex: 1,
    minHeight: 43,
    maxHeight: 125,
    paddingVertical: 10,
    fontSize: 16,
    lineHeight: 24,
    color: palette.ink,
  },
  sendButton: {
    height: 48,
    width: 48,
    borderRadius: 22,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  busyRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  cancel: { minHeight: 48, justifyContent: "center", paddingHorizontal: 9 },
  linkText: {
    fontFamily: "Manrope_700Bold",
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
  },
  note: {
    fontFamily: "Manrope_400Regular",
    fontSize: 13,
    lineHeight: 20,
    color: palette.muted,
    paddingVertical: 5,
  },
  errorBox: {
    padding: 13,
    borderRadius: 12,
    backgroundColor: "#F6E7E1",
    gap: 5,
  },
  dayHeading: { gap: 9, paddingVertical: 8 },
  dayTitle: {
    fontFamily: "Manrope_600SemiBold",

    fontSize: 28,
    lineHeight: 34,
    color: palette.ink,
    letterSpacing: -0.8,
  },
  stopCard: {
    borderRadius: 23,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.white,
    padding: 19,
    gap: 13,
  },
  stopNumber: {
    height: 32,
    width: 32,
    borderRadius: 16,
    backgroundColor: palette.green,
    alignItems: "center",
    justifyContent: "center",
  },
  numberText: {
    fontFamily: "Manrope_700Bold",
    fontSize: 12,
    color: palette.ink,
  },
  stopTitle: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 22,
    lineHeight: 28,
    color: palette.ink,
    letterSpacing: -0.5,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: palette.line,
    paddingTop: 12,
  },
  evidence: { flexDirection: "row", gap: 10, paddingHorizontal: 4 },
  noticeCard: {
    padding: 15,
    gap: 10,
    backgroundColor: "#E9EEDC",
    borderRadius: 15,
  },
  empty: { paddingVertical: 35, gap: 20 },
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(18,37,30,0.36)",
  },
  sheet: {
    maxHeight: "93%",
    backgroundColor: palette.paper,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#C1CCBD",
    marginTop: 10,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 22,
    paddingRight: 12,
    paddingVertical: 10,
    gap: 8,
  },
  sheetTitle: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 22,
    color: palette.ink,
    flex: 1,
    letterSpacing: -0.5,

    lineHeight: 28,
  },
  sheetBody: { paddingHorizontal: 22, paddingBottom: 30, gap: 17 },
  field: { gap: 8 },
  label: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 14,
    color: palette.ink,
    lineHeight: 20,
  },
  input: {
    fontFamily: "Manrope_400Regular",
    minHeight: 50,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: palette.ink,
    backgroundColor: palette.white,

    lineHeight: 24,
  },
  areaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderColor: palette.line,
    minHeight: 68,
  },
  areaIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.green,
    alignItems: "center",
    justifyContent: "center",
  },
  itemTitle: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 16,
    lineHeight: 23,
    color: palette.ink,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
});
