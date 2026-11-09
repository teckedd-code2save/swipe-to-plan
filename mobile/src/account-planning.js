// Account work stays in memory. Local guest drafts are restored when the
// account changes; only an explicit Save copy action writes an account plan.
const validTarget = (value) => value &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id) &&
  Number.isSafeInteger(value.revision) && value.revision > 0;
export function createAccountWorkspace() {
  let identity = null, guest = null, target = null;
  return {
    switchIdentity(next, draft) {
      if (identity === next) return null;
      const restored = identity ? guest : null;
      guest = next ? JSON.parse(JSON.stringify(restored || draft)) : null;
      identity = next;
      target = null;
      return restored;
    },
    isPrivate: () => identity !== null,
    remember(plan, editable = true) {
      if (!identity) return;
      const saved = plan?.savedPlan;
      target = editable && validTarget(saved) ? { id: saved.id, revision: saved.revision } : null;
    },
    headers() {
      return identity && target ? {
        'x-unstressed-plan-id': target.id,
        'x-unstressed-plan-revision': String(target.revision + 1),
      } : {};
    },
    clearTarget() { target = null; },
  };
}
