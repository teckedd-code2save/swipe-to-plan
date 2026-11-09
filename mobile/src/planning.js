import { validTimeZone } from "./validation.js";
import { pinKey, pinnedPlace, reviseStops } from "../../shared/stop-intents.js";
import { withSelectedRoute } from "../../shared/selected-route.js";
export { planTitle } from "../../shared/plan-title.js";

export const activityLabels = {
  coffee: "Coffee",
  activity: "Explore",
  dinner: "A meal",
  drinks: "Drinks",
};
export function newBrief(now = new Date()) {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return {
    title: "",
    titleSource: "auto",
    area: "",
    currencyMode: "local",
    date,
    timing: {
      dateConfirmed: false,
      timeConfirmed: false,
      mode: "flexible",
      window: "any",
    },
    party: { adults: 1, children: 0 },
    people: [{ id: "you", name: "You", artists: [], vibes: [] }],
    budget: null,
    currency: "USD",
    startTime: "09:00",
    endTime: "22:00",
    pace: "easy",
    activities: [],
    pins: {},
    excludeIds: [],
  };
}
export function confirmArea(brief, area) {
  if (!area?.id || !area.label)
    throw new Error("Choose a returned planning area.");
  const changed = brief.locationId !== area.id;
  const next = {
    ...brief,
    area: area.label,
    locationId: area.id,
    ...(brief.currencyMode === "local"
      ? {
          currency: area.currency || brief.currency,
          ...(changed ? { budget: null } : {}),
        }
      : {}),
    ...(changed
      ? {
          pins: {},
          excludeIds: [],
          route: undefined,
          searchRadiusKm: undefined,
        }
      : {}),
    ...(brief.titleSource === "auto" ? { title: "" } : {}),
  };
  return next;
}
export function chooseActivities(brief, activities) {
  return {
    ...brief,
    ...reviseStops(brief, { activities }),
    ...(brief.titleSource === "auto" ? { title: "" } : {}),
  };
}

// Indexes identify visit occurrences, including two visits to the same venue.
// Keep all untouched places in place and let the server revalidate evidence.
export function editStop(plan, index, operation, replacementId) {
  if (!plan?.stops?.[index])
    throw new Error("That visit is no longer in the plan.");
  const visits = plan.stops.map((stop, i) => ({
    intent: stop.intent,
    placeId: stop.item?.id || pinnedPlace(plan.request, i),
  }));
  const oldId = visits[index].placeId;
  if (operation === "replace") {
    if (
      !plan.stops[index].alternatives?.some((item) => item.id === replacementId)
    )
      throw new Error("Choose a returned alternative.");
    visits[index].placeId = replacementId;
  } else if (operation === "swap") {
    if (
      oldId &&
      visits.some((visit, i) => i !== index && visit.placeId === oldId)
    ) {
      const alternative = plan.stops[index].alternatives?.find(
        (item) =>
          item.id !== oldId &&
          !visits.some((visit) => visit.placeId === item.id),
      );
      if (!alternative)
        throw new Error(
          "No different alternative was returned for this repeated visit. Keep it or choose another returned place.",
        );
      return editStop(plan, index, "replace", alternative.id);
    }
    visits[index].placeId = undefined;
  } else if (operation === "remove") {
    if (visits.length < 2)
      throw new Error(
        "Keep at least one visit. Start a new outing to clear it.",
      );
    visits.splice(index, 1);
  } else if (operation === "up") {
    if (!index) throw new Error("This visit is already first.");
    [visits[index - 1], visits[index]] = [visits[index], visits[index - 1]];
  } else throw new Error("Unknown stop edit.");
  const sequence = visits.map((stop) => stop.intent);
  const request = {
    ...plan.request,
    activities: [...new Set(sequence)],
    stopIntents: sequence,
    route: undefined,
    pins: {},
    ...(plan.request.titleSource === "auto" ? { title: "" } : {}),
  };
  const excluded = new Set(request.excludeIds || []);
  if (operation === "swap" && oldId) excluded.add(oldId);
  // A selected alternative may have been excluded by an older swap.
  if (operation === "replace") excluded.delete(replacementId);
  request.excludeIds = [...excluded].slice(-100);
  if (visits.every((visit) => visit.placeId) && operation !== "swap")
    return withSelectedRoute(request, visits);
  visits.forEach((visit, i) => {
    if (visit.placeId) request.pins[pinKey(request, i)] = visit.placeId;
  });
  return request;
}
export function planContext(plan) {
  if (!plan) return undefined;
  const summary = (stop, item = stop.item) => ({
    id: item.id,
    intent: stop.intent,
    name: item.name.slice(0, 200),
    practical: JSON.stringify({
      ...(typeof item.description === "string"
        ? { description: item.description.slice(0, 180) }
        : {}),
      reportedTags: (Array.isArray(item.tagNames) ? item.tagNames : [])
        .filter((tag) => typeof tag === "string")
        .slice(0, 4)
        .map((tag) => tag.slice(0, 60)),
      relativePriceBand:
        Number.isInteger(item.facts?.price?.level) &&
        item.facts.price.level >= 1 &&
        item.facts.price.level <= 4
          ? item.facts.price.level
          : null,
      ...(item === stop.item ? { start: stop.start, end: stop.end } : {}),
      hours: "Not checked for this visit in chat",
      priceVerified: false,
      connectionCoverage:
        item === stop.item && stop.connections?.length
          ? "supplied links"
          : "not computed; not negative evidence",
      source: "provider data; current availability unverified",
    }),
    connections: (item === stop.item ? stop.connections || [] : [])
      .slice(0, 144)
      .map(({ personId, kind, label }) => ({
        personId,
        kind,
        label: label.slice(0, 240),
      })),
  });
  const options = new Map();
  for (const stop of plan.stops)
    for (const item of [stop.item, ...(stop.alternatives || [])].filter(
      Boolean,
    )) {
      if (!options.has(item.id)) options.set(item.id, summary(stop, item));
    }
  return {
    stops: plan.stops
      .filter((stop) => stop.item)
      .map((stop) => ({ ...summary(stop), stopId: stop.id })),
    requestedStopCount: plan.stops.length,
    options: [...options.values()].slice(0, 12),
    warnings: (plan.warnings || []).slice(0, 30),
  };
}
export function groundedRoute(plan, result) {
  const context = planContext(plan);
  if (
    !context ||
    !result.route?.every((visit) =>
      context.options.some((option) => option.id === visit.placeId),
    )
  )
    throw new Error("Choose places from the current results.");
  return withSelectedRoute(
    { ...plan.request, ...result.request },
    result.route,
  );
}
export function coarsePoint(position, now = Date.now()) {
  const { latitude, longitude, accuracy } = position?.coords || {};
  if (
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180 ||
    !Number.isFinite(accuracy) ||
    accuracy < 0 ||
    accuracy > 25000 ||
    !Number.isFinite(position.timestamp) ||
    now - position.timestamp > 300000 ||
    position.timestamp > now + 60000
  )
    throw new Error(
      "Your location is too broad or out of date. Search by area instead.",
    );
  return {
    latitude: Math.round(latitude * 100) / 100,
    longitude: Math.round(longitude * 100) / 100,
  };
}
export function mapsUrl(stop) {
  if (!stop?.item?.name || stop.item.id?.startsWith("demo:")) return null;
  const address =
    typeof stop.item.address === "string" ? stop.item.address : "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([stop.item.name, address].filter(Boolean).join(", "))}`;
}

export function personWithId(person, people) {
  const id =
    person.id ||
    `person-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  if (people.some((existing) => existing.id === id))
    throw new Error("That person is already in this outing.");
  return { ...person, id };
}

export function destinationTimeZone(
  draft,
  fallback = Intl.DateTimeFormat().resolvedOptions().timeZone,
) {
  const candidate =
    draft.plan?.request.area === draft.brief.area
      ? draft.plan.timeZone || draft.planningTimeZone
      : draft.planningTimeZone;
  return validTimeZone(candidate)
    ? candidate
    : validTimeZone(fallback)
      ? fallback
      : "UTC";
}
