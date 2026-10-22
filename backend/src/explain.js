// Explanations use checked evidence, without a model or a network request.
export function explainCandidate(item) {
  return item.reasons.filter((r) => ["intent_match", "taste_affinity", "vibe_match", "noise_penalty", "group_rank"].includes(r.code)).map((r) => r.text).join(" ");
}
