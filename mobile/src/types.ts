export type Intent = "coffee" | "activity" | "dinner" | "drinks";
export type Person = {
  id: string;
  name: string;
  artists: string[];
  vibes: string[];
  spending?: { style: string; priority: string };
  context?: {
    role?: string;
    roleQuote?: string;
    audiences?: string[];
    interests?: { type: string; name: string; quote?: string }[];
  };
};
export type Brief = {
  title: string;
  titleSource: string;
  area: string;
  locationId?: string;
  currencyMode: string;
  date: string;
  timing: {
    dateConfirmed: boolean;
    timeConfirmed: boolean;
    mode: string;
    window?: string;
  };
  party: { adults: number; children: number };
  people: Person[];
  budget: number | null;
  currency: string;
  startTime: string;
  endTime: string;
  pace: string;
  activities: Intent[];
  stopIntents?: Intent[];
  route?: { intent: Intent; placeId: string }[];
  pins: Record<string, string>;
  excludeIds: string[];
};
export type Venue = {
  id: string;
  entityId?: string;
  name: string;
  address?: string;
  category?: string;
  description?: string;
};
export type Stop = {
  id: string;
  intent: Intent;
  item: Venue | null;
  alternatives: Venue[];
  start?: string;
  end?: string;
  unfilledReason?: string;
  reason?: string;
  connections?: { personId: string; kind: string; label: string }[];
};
export type Plan = {
  savedPlan?: { id: string; revision: number };
  saveError?: string;
  request: Brief;
  status: string;
  phase?: string;
  timeZone?: string;
  stops: Stop[];
  warnings?: string[];
  budget?: { total: number | null; currency: string; note?: string };
  provenance?: { provider?: string; retrievedAt?: string };
  qualityReview?: { status: string };
};
export type Area = {
  id: string;
  label: string;
  name: string;
  country?: string;
  currency?: string;
  timeZone?: string;
};
export type Message = { role: "assistant" | "user"; text: string };
export type Draft = {
  planningTimeZone?: string;
  brief: Brief;
  confirmed: boolean;
  plan: Plan | null;
};
