import { isBrief, isPlan, validTimeZone } from "./validation.js";
// One epoch spans chat, discovery, edits, reset and backgrounding. Abort is best
// effort; the epoch guard also rejects results from transports that ignore it.
export function createRequestGate() {
  let epoch = 0,
    controller;
  return {
    begin() {
      controller?.abort();
      controller = new AbortController();
      const version = ++epoch;
      return {
        signal: controller.signal,
        current: () => epoch === version && !controller.signal.aborted,
      };
    },
    invalidate() {
      epoch++;
      controller?.abort();
    },
  };
}
export function createDraftStore(storage, key = "unstressed.native.draft.v1") {
  let pending = Promise.resolve();
  const enqueue = (operation) => {
    const job = pending.catch(() => {}).then(operation);
    pending = job;
    return job;
  };
  return {
    async load() {
      const raw = await storage.getItem(key);
      if (!raw) return null;
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new Error(
          "The saved draft could not be read. Start a new outing to clear it.",
        );
      }
      if (
        value.version !== 1 ||
        !isBrief(value.brief) ||
        typeof value.confirmed !== "boolean" ||
        (value.plan !== null && !isPlan(value.plan))
      )
        throw new Error(
          "The saved draft is incompatible. Start a new outing to clear it.",
        );
      return value;
    },
    /** @param {{brief: any, confirmed: boolean, plan: any, planningTimeZone?: string}} snapshot */
    save({ brief, confirmed, plan, planningTimeZone }) {
      // Deliberately exclude chat, GPS fixes, credentials and account metadata.
      const readiness = plan
        ? {
            ...(plan.allowance &&
            Number.isFinite(plan.allowance.amount) &&
            plan.allowance.amount >= 0 &&
            plan.allowance.amount <= 10000000 &&
            ["suggested", "specified"].includes(plan.allowance.kind)
              ? {
                  allowance: {
                    amount: plan.allowance.amount,
                    kind: plan.allowance.kind,
                    pricesVerified: false,
                  },
                }
              : {}),
            ...(Array.isArray(plan.timingNotes)
              ? {
                  timingNotes: plan.timingNotes
                    .filter(
                      (note) => typeof note === "string" && note.length <= 2000,
                    )
                    .slice(0, 10),
                }
              : {}),
          }
        : {};
      const snapshot = JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        brief,
        ...(validTimeZone(planningTimeZone) ? { planningTimeZone } : {}),
        confirmed,
        plan: plan
          ? {
              ...readiness,
              ...Object.fromEntries(
                [
                  "request",
                  "status",
                  "phase",
                  "stops",
                  "budget",
                  "warnings",
                  "provenance",
                  "tasteMap",
                  "timeZone",
                  "qualityReview",
                ]
                  .filter((key) => plan[key] !== undefined)
                  .map((key) => [key, plan[key]]),
              ),
            }
          : null,
      });
      let bytes = 0;
      for (const character of snapshot) {
        const code = character.codePointAt(0);
        bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      }
      if (bytes > 1500000)
        return Promise.reject(
          new Error("This plan is too large to keep on this device."),
        );
      return enqueue(() => storage.setItem(key, snapshot));
    },
    clear() {
      return enqueue(() => storage.removeItem(key));
    },
  };
}
