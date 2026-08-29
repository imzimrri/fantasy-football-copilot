/**
 * Resolves a (possibly slightly-off) name string to the exact candidate it meant —
 * case/whitespace-insensitive exact match first, then substring match either
 * direction (handles "Justin Fields (QB)" vs "Justin Fields", or an LLM appending
 * team/position context to a player name). Returns null if nothing plausible matches.
 *
 * Shared by: lib/agents/waiver-research.ts (matching an LLM's dropCandidate string to
 * a real bench player) and the roster UI (matching a recommendation's payload.player
 * string to a roster player, to show it inline on the right lineup slot).
 */
export function fuzzyMatchName(raw: string, candidates: string[]): string | null {
  const normalize = (s: string) => s.trim().toLowerCase();
  const target = normalize(raw);
  const exact = candidates.find((c) => normalize(c) === target);
  if (exact) return exact;
  const partial = candidates.find(
    (c) => target.includes(normalize(c)) || normalize(c).includes(target),
  );
  return partial ?? null;
}
