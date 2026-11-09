const object = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const string = (value, max = 2000) =>
  typeof value === "string" && value.length <= max;
const list = (value, max, check) =>
  Array.isArray(value) && value.length <= max && value.every(check);
const intents = new Set(["coffee", "activity", "dinner", "drinks"]);
export function isBrief(brief) {
  return (
    object(brief) &&
    string(brief.title, 80) &&
    string(brief.area, 160) &&
    string(brief.currency, 3) &&
    /^\d{4}-\d{2}-\d{2}$/.test(brief.date) &&
    string(brief.startTime, 5) &&
    string(brief.endTime, 5) &&
    object(brief.timing) &&
    typeof brief.timing.dateConfirmed === "boolean" &&
    typeof brief.timing.timeConfirmed === "boolean" &&
    object(brief.party) &&
    Number.isInteger(brief.party.adults) &&
    brief.party.adults >= 1 &&
    brief.party.adults <= 100 &&
    Number.isInteger(brief.party.children) &&
    brief.party.children >= 0 &&
    brief.party.children <= 100 &&
    list(
      brief.people,
      6,
      (person) =>
        object(person) &&
        string(person.id, 64) &&
        /^[a-zA-Z0-9_-]{1,64}$/.test(person.id) &&
        string(person.name, 24) &&
        list(person.artists, 6, (value) => string(value, 160)) &&
        list(person.vibes, 64, (value) => string(value, 160)),
    ) &&
    brief.people.length > 0 &&
    new Set(brief.people.map((person) => person.id)).size ===
      brief.people.length &&
    list(brief.activities, 3, (intent) => intents.has(intent)) &&
    object(brief.pins) &&
    list(brief.excludeIds, 100, (value) => string(value, 160)) &&
    (brief.budget === null ||
      (Number.isInteger(brief.budget) &&
        brief.budget > 0 &&
        brief.budget <= 10000000))
  );
}
const venue = (value) =>
  object(value) &&
  string(value.id, 160) &&
  string(value.name, 500) &&
  (value.address == null || string(value.address, 2000));
export function isPlan(plan) {
  return (
    object(plan) &&
    isBrief(plan.request) &&
    ["complete", "partial"].includes(plan.status) &&
    list(
      plan.stops,
      3,
      (stop) =>
        object(stop) &&
        string(stop.id, 160) &&
        intents.has(stop.intent) &&
        (stop.item === null || venue(stop.item)) &&
        list(stop.alternatives, 20, venue) &&
        (stop.start == null || string(stop.start, 5)) &&
        (stop.end == null || string(stop.end, 5)) &&
        (stop.connections == null ||
          list(
            stop.connections,
            420,
            (edge) =>
              object(edge) &&
              string(edge.personId, 64) &&
              string(edge.kind, 64) &&
              string(edge.label, 2000),
          )),
    ) &&
    (plan.warnings == null ||
      list(plan.warnings, 100, (value) => string(value, 4000)))
  );
}
export function requirePlan(plan) {
  if (!isPlan(plan))
    throw new Error(
      "The server returned an incomplete plan. Your previous plan is kept.",
    );
  return plan;
}

export function requireAreas(result) {
  if (
    !object(result) ||
    !list(
      result.locations,
      20,
      (area) =>
        object(area) &&
        string(area.id, 160) &&
        string(area.name, 500) &&
        string(area.label, 1000) &&
        (area.currency == null || string(area.currency, 3)),
    )
  )
    throw new Error(
      "Area search returned an incomplete result. Try another search.",
    );
  return result.locations;
}

export function validTimeZone(value) {
  if (typeof value !== "string" || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
