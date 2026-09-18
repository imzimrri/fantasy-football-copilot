import { z } from "zod";
import { generateJSON } from "@/lib/llm";
import { getCurrentFantasyWeek, getTrendingPlayers } from "@/lib/sleeper";
import type { Result } from "@/lib/sleeper";
import { research } from "@/lib/perplexity";
import { fuzzyMatchName } from "@/lib/fuzzy-match";
import {
  buildCoachDirective,
  buildTeamStrategySummary,
  loadAgentContext,
  replacePendingRecommendations,
} from "@/lib/agents/shared";
import { PREFERRED_SOURCES_NOTE } from "@/lib/agents/preferred-sources";
import { resolveStaleWaiverRecommendations } from "@/lib/waiver-moves";

/**
 * Builds the output schema dynamically because whether `dropCandidate` is required
 * depends on runtime roster state, not something a static schema can express. When
 * the roster is full, every entry that recommends an actual add MUST include a
 * non-empty dropCandidate — enforced via superRefine rather than a flat required
 * field, because `addPlayer` itself is optional: an entry can be a pure response to
 * one of the user's own player notes (e.g. defending a handcuff stash) with no add/
 * drop attached at all. Whether dropCandidate exactly matches a real bench name is
 * checked separately in `resolveDropCandidate`, with fuzzy matching — a strict
 * exact-match refine here proved too brittle: one recommendation with an LLM-mangled
 * name (extra whitespace, slight rephrasing) would fail the ENTIRE batch, observed in
 * testing. `.nullish()` (not `.optional()`) on all three — real bug hit live: despite
 * being told to OMIT these fields for a note-response entry, the model instead wrote
 * explicit `null`, which `.optional()` rejects (it only accepts the key being absent,
 * not present-with-null) and failed the whole batch.
 */
function buildWaiverOutputSchema(rosterIsFull: boolean) {
  return z.object({
    recommendations: z
      .array(
        z.object({
          title: z.string(),
          reasoning: z.string(),
          restOfSeasonOutlook: z.string().nullish(),
          addPlayer: z.string().nullish(),
          dropCandidate: z.string().nullish(),
        }),
      )
      .min(1)
      .superRefine((recs, ctx) => {
        recs.forEach((r, i) => {
          // restOfSeasonOutlook is only required for a real add recommendation — a
          // drop is a season-long decision. A pure note-response entry (no addPlayer)
          // doesn't need one.
          if (r.addPlayer && !r.restOfSeasonOutlook) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "restOfSeasonOutlook is required when an add is recommended — a drop is a season-long decision",
              path: [i, "restOfSeasonOutlook"],
            });
          }
          if (rosterIsFull && r.addPlayer && !r.dropCandidate) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "dropCandidate is required when the roster is full and an add is recommended",
              path: [i, "dropCandidate"],
            });
          }
        });
      }),
  });
}

/** Thin, named wrapper over the shared fuzzy matcher — kept for call-site clarity. */
export function resolveDropCandidate(raw: string, benchNames: string[]): string | null {
  return fuzzyMatchName(raw, benchNames);
}

/**
 * FR10-13: ranked waiver-wire pickups. Grounded in Sleeper's real trending-add data
 * (platform-wide add counts in the last 24h), not an LLM guessing across thousands of
 * free agents with no recency signal — filtered to players actually unrostered in this
 * specific league, then reasoned about against the user's own roster needs.
 */
export async function runWaiverResearch(): Promise<Result<{ recommendationCount: number }>> {
  const contextResult = await loadAgentContext();
  if (!contextResult.ok) return contextResult;
  const ctx = contextResult.data;

  // Defense in depth (see resolveStaleWaiverRecommendations doc comment) — the manual
  // refresh button already does this right after a sync, but this covers the plain
  // daily-cron path too, in case a real move happened without the user ever hitting
  // refresh.
  await resolveStaleWaiverRecommendations(
    ctx.db,
    ctx.userId,
    ctx.leagueId,
    ctx.ownRosterPlayers.map((p) => p.fullName),
  );

  const weekResult = await getCurrentFantasyWeek();
  if (!weekResult.ok) return weekResult;
  const week = weekResult.data;

  const trendingResult = await getTrendingPlayers("add", 24, 25);
  if (!trendingResult.ok) return trendingResult;

  // Which of the trending players (or watchlist players) are actually rostered
  // somewhere in MY league — i.e., not actually available to add?
  const { data: leagueRosterIds, error: rosterIdsError } = await ctx.db
    .from("rosters")
    .select("id")
    .eq("league_id", ctx.leagueId);

  if (rosterIdsError) {
    return { ok: false, error: `Failed to load league rosters: ${rosterIdsError.message}` };
  }

  const candidateIds = [
    ...new Set([
      ...trendingResult.data.map((t) => t.player_id),
      ...ctx.watchlist.map((w) => w.sleeperPlayerId),
    ]),
  ];
  const { data: rosteredRows, error: rosteredError } = await ctx.db
    .from("roster_players")
    .select("sleeper_player_id")
    .in("sleeper_player_id", candidateIds)
    .in("roster_id", (leagueRosterIds ?? []).map((r) => r.id));

  if (rosteredError) {
    return { ok: false, error: `Failed to check rostered players: ${rosteredError.message}` };
  }

  const rosteredIds = new Set((rosteredRows ?? []).map((r) => r.sleeper_player_id as string));
  const availableTrending = trendingResult.data.filter((t) => !rosteredIds.has(t.player_id));
  // Watchlist players who are trending too shouldn't be listed twice.
  const trendingIdSet = new Set(availableTrending.map((t) => t.player_id));
  const availableWatchlist = ctx.watchlist.filter(
    (w) => !rosteredIds.has(w.sleeperPlayerId) && !trendingIdSet.has(w.sleeperPlayerId),
  );

  // Trending-DROP data (best-effort — never blocks the run on failure): a bench
  // player ALSO trending in drops platform-wide is stronger real-world evidence for
  // actually dropping them; a candidate ADD that's also seeing notable drops
  // elsewhere is worth a second look (bye week vs. real bad news) rather than blind
  // trust in raw add momentum alone.
  const trendingDropsResult = await getTrendingPlayers("drop", 24, 25);
  if (!trendingDropsResult.ok) {
    console.warn("[waiver-research] Trending-drop data unavailable:", trendingDropsResult.error);
  }
  const dropCountById = new Map<string, number>(
    trendingDropsResult.ok ? trendingDropsResult.data.map((t) => [t.player_id, t.count]) : [],
  );

  const { data: playerInfoRows, error: playerInfoError } = await ctx.db
    .from("players")
    .select("sleeper_player_id, full_name, position, team, status")
    .in(
      "sleeper_player_id",
      availableTrending.map((t) => t.player_id),
    );

  if (playerInfoError) {
    return { ok: false, error: `Failed to load player info: ${playerInfoError.message}` };
  }

  const infoById = new Map((playerInfoRows ?? []).map((p) => [p.sleeper_player_id, p]));
  const dropNote = (playerId: string) => {
    const count = dropCountById.get(playerId);
    return count ? ` — also being DROPPED by ${count} teams platform-wide (check why before trusting the add momentum)` : "";
  };
  const trendingSummary = availableTrending
    .map((t) => {
      const info = infoById.get(t.player_id);
      if (!info) return null;
      return `${info.full_name} — ${info.position ?? "?"} ${info.team ?? "FA"} — added by ${t.count} teams in the last 24h${info.status ? ` — status: ${info.status}` : ""}${dropNote(t.player_id)}`;
    })
    .filter(Boolean)
    .join("\n");

  // Watchlist players get evaluated every run regardless of whether they're
  // currently trending — that's the whole point of a watchlist (catch a player
  // BEFORE the crowd bids them up), per the user's own request.
  const watchlistSummary = availableWatchlist
    .map(
      (w) =>
        `${w.fullName} — ${w.position ?? "?"} ${w.team ?? "FA"}${w.status ? ` — status: ${w.status}` : ""} — ` +
        `on your WATCHLIST${w.note ? ` (your note: "${w.note}")` : ""}, available now${dropNote(w.sleeperPlayerId)}`,
    )
    .join("\n");

  // Discovery step: Sleeper's trending list only shows players the CROWD has already
  // caught onto — it's an add-count ranking, by definition. To catch someone BEFORE
  // that happens, ask Perplexity an open-ended question instead of only researching a
  // pre-selected list. Any name it surfaces gets resolved against the real `players`
  // table before it's ever shown to the main reasoning call — same discipline every
  // other candidate source in this file already follows, since free-text research can
  // misspell a name or reference someone who isn't a real, currently rostered-in-the-
  // NFL fantasy option.
  const knownNames = new Set([
    ...availableTrending.map((t) => infoById.get(t.player_id)?.full_name).filter(Boolean),
    ...availableWatchlist.map((w) => w.fullName),
  ]);

  interface DiscoveredPlayerRow {
    sleeper_player_id: string;
    full_name: string;
    position: string | null;
    team: string | null;
    status: string | null;
  }
  let discoveredCandidates: DiscoveredPlayerRow[] = [];

  const scoringRec = ctx.scoringSettings?.rec;
  const scoringLabel =
    scoringRec === 1 ? "PPR" : scoringRec === 0 || scoringRec === undefined ? "standard (non-PPR)" : "half-PPR";
  const formatNote = (ctx.rosterPositions ?? []).includes("SUPER_FLEX")
    ? " in a Superflex/2-QB format (QB value is much higher than a standard 1-QB league)"
    : "";

  const discoveryResult = await research(
    `What are the best fantasy football waiver-wire pickups worth grabbing right now ` +
      `for a ${scoringLabel} league${formatNote}? Focus specifically on under-the-radar ` +
      `players with rising opportunity, snap share, or role who may NOT yet be showing ` +
      `up on widely-publicized trending-add lists — the kind of pickup a manager would ` +
      `miss if they only looked at raw add counts. Give specific player full names.` +
      PREFERRED_SOURCES_NOTE,
  );

  if (!discoveryResult.ok) {
    console.warn("[waiver-research] Discovery research degraded:", discoveryResult.error);
  } else {
    const extractResult = await generateJSON({
      system:
        "Extract every specific current NFL player full name mentioned in this " +
        "fantasy football research as a worthwhile waiver-wire pickup. Return exact " +
        "names as written in the text — don't guess spellings or add anyone not " +
        "explicitly named.",
      // The exact key name MUST be spelled out in the prompt itself, not just implied
      // by the system message — real bug hit live: without this, the model invented
      // its own key (e.g. "nfl_players_mentioned") and failed schema validation on
      // every single run, silently contributing zero discovery candidates.
      prompt:
        `${discoveryResult.data.answer}\n\n` +
        `Return JSON: { "playerNames": string[] }.`,
      schema: z.object({ playerNames: z.array(z.string()) }),
    });
    if (!extractResult.ok) {
      console.warn("[waiver-research] Discovery name extraction failed:", extractResult.error);
    }

    if (extractResult.ok && extractResult.data.playerNames.length > 0) {
      const candidateNamesFromDiscovery = [...new Set(extractResult.data.playerNames)].filter(
        (n) => !fuzzyMatchName(n, [...knownNames]),
      );

      const matchResults = await Promise.all(
        candidateNamesFromDiscovery.map((name) =>
          ctx.db
            .from("players")
            .select("sleeper_player_id, full_name, position, team, status")
            .ilike("full_name", `%${name}%`)
            .limit(5),
        ),
      );

      const resolved: DiscoveredPlayerRow[] = [];
      const seenIds = new Set<string>();
      matchResults.forEach((result, i) => {
        const rows = (result.data ?? []) as DiscoveredPlayerRow[];
        if (rows.length === 0) return;
        const bestNameMatch = fuzzyMatchName(
          candidateNamesFromDiscovery[i],
          rows.map((r) => r.full_name),
        );
        const match = rows.find((r) => r.full_name === bestNameMatch) ?? rows[0];
        if (!seenIds.has(match.sleeper_player_id)) {
          seenIds.add(match.sleeper_player_id);
          resolved.push(match);
        }
      });

      if (resolved.length > 0) {
        const discoveredIds = resolved.map((r) => r.sleeper_player_id);
        const { data: discoveredRosteredRows } = await ctx.db
          .from("roster_players")
          .select("sleeper_player_id")
          .in("sleeper_player_id", discoveredIds)
          .in("roster_id", (leagueRosterIds ?? []).map((r) => r.id));
        const discoveredRosteredSet = new Set(
          (discoveredRosteredRows ?? []).map((r) => r.sleeper_player_id as string),
        );
        discoveredCandidates = resolved.filter(
          (r) => !rosteredIds.has(r.sleeper_player_id) && !discoveredRosteredSet.has(r.sleeper_player_id),
        );
      }
    }
  }

  const discoverySummary = discoveredCandidates
    .map(
      (d) =>
        `${d.full_name} — ${d.position ?? "?"} ${d.team ?? "FA"}${d.status ? ` — status: ${d.status}` : ""} — ` +
        `surfaced by broader research, not yet on the trending list${dropNote(d.sleeper_player_id)}`,
    )
    .join("\n");

  if (
    availableTrending.length === 0 &&
    availableWatchlist.length === 0 &&
    discoveredCandidates.length === 0
  ) {
    return { ok: true, data: { recommendationCount: 0 } };
  }

  const rosterSummary = ctx.ownRosterPlayers
    .map((p) => `${p.fullName} — ${p.position ?? "?"} ${p.team ?? "FA"} — ${p.isStarter ? "STARTER" : "bench"}`)
    .join("\n");

  // Roster-full check: computed from real numbers (roster size vs. the league's
  // required roster_positions count), not left for the LLM to infer or guess at.
  const maxRosterSize = ctx.rosterPositions?.length ?? ctx.ownRosterPlayers.length;
  const rosterIsFull = ctx.ownRosterPlayers.length >= maxRosterSize;
  const benchPlayers = ctx.ownRosterPlayers.filter((p) => !p.isStarter);
  const benchNames = benchPlayers.map((p) => p.fullName);
  const benchSummary = benchPlayers
    .map((p) => `${p.fullName} — ${p.position ?? "?"} ${p.team ?? "FA"}`)
    .join("\n");

  // Research step (Perplexity): current news on BOTH sides of every potential move —
  // the trending add candidates AND the bench players who could be dropped. Real bug
  // found and fixed here: this used to only research the add candidates, so any claim
  // about a bench player's current depth-chart role (e.g. "WR4/5") was pure LLM recall
  // with no grounding — and could be stale/wrong (verified: a real bench player was
  // called a backup when they're actually their team's clear WR2). Degrades gracefully
  // if research fails entirely, since it's an enhancement, not a hard dependency — but
  // when it succeeds, it must cover everyone the LLM might make a claim about.
  const candidateNames = [
    ...availableTrending.map((t) => infoById.get(t.player_id)?.full_name).filter(Boolean),
    ...availableWatchlist.map((w) => w.fullName),
    ...discoveredCandidates.map((d) => d.full_name),
  ].join(", ");
  const researchResult = await research(
    `For fantasy football: (1) Why are these NFL players trending in adds right now, ` +
      `or — for anyone on this list who ISN'T currently trending but is being tracked ` +
      `on a watchlist or was surfaced by broader research — what is their current ` +
      `role/opportunity, and their rest-of-season outlook: ${candidateNames}. (2) What ` +
      `is each of these players' CURRENT depth-chart role/snap share on their real ` +
      `NFL team right now: ${benchNames.join(", ")}.` +
      PREFERRED_SOURCES_NOTE,
  );
  if (!researchResult.ok) {
    console.warn("[waiver-research] Perplexity research degraded:", researchResult.error);
  }
  const researchContext = researchResult.ok
    ? `\n\nCurrent news research (covers both the trending adds AND your bench players):\n${researchResult.data.answer}`
    : "";
  const sources = researchResult.ok ? researchResult.data.sources : [];

  const rosterStatusLine = rosterIsFull
    ? `My roster is FULL (${ctx.ownRosterPlayers.length}/${maxRosterSize} spots used). ` +
      `EVERY recommendation you make MUST include a "dropCandidate" — pick it from ` +
      `this exact bench list, never a starter, never a player not listed:\n${benchSummary}`
    : `My roster has open spots (${ctx.ownRosterPlayers.length}/${maxRosterSize} used) ` +
      `— a drop isn't required, but you may still suggest one if it clearly improves ` +
      `the roster.`;

  // The user's own stated reasoning for holding specific roster players (e.g. "handcuff
  // in case Mahomes gets hurt"). Only include players who actually have a note — most
  // won't. If any note applies to a player suggested as a dropCandidate, or to a bench
  // player that's a plausible drop, the LLM is required (system prompt) to explicitly
  // engage with it rather than silently overriding the user's stated intent.
  const notesLines = ctx.ownRosterPlayers
    .map((p) => {
      const note = ctx.playerNotes.get(p.sleeperPlayerId);
      return note ? `${p.fullName}: "${note}"` : null;
    })
    .filter(Boolean);
  const notesSummary =
    notesLines.length > 0
      ? `\n\nThe user's own stated reasoning for holding certain roster players — you ` +
        `MUST explicitly address any of these that are relevant to a dropCandidate you ` +
        `suggest. Either confirm their reasoning still holds (and avoid recommending ` +
        `that drop unless the case for the add is genuinely strong enough to override ` +
        `it), or directly and specifically explain why it no longer holds and the drop ` +
        `is right anyway. Never silently ignore a note:\n${notesLines.join("\n")}`
      : "";

  const llmResult = await generateJSON({
    system:
      "You are a fantasy football waiver-wire analyst. You're given a real list of " +
      "players currently trending upward in adds (not on any roster in this league), " +
      "the user's own watchlist of free agents they want tracked even before they " +
      "trend, a broader discovery research pass that surfaced additional " +
      "under-the-radar options NOT yet on the trending list, current news research " +
      "on why, and the user's current roster. Recommend which of these free agents " +
      "are worth adding for THIS roster specifically. Only recommend players from " +
      "the trending, watchlist, or discovery lists provided — never invent players " +
      "outside these three.\n\n" +
      "IMPORTANT — quality over volume: a player being available, trending, or " +
      "surfaced by research is NOT by itself a reason to recommend them. The bar is " +
      "specific fit and need for THIS roster — chasing every hyped name is exactly " +
      "how a manager ends up churning the roster all season for a mix of real hits " +
      "and real flops. It's a completely legitimate, GOOD outcome for a run to " +
      "produce zero add recommendations because nothing available clears that bar — " +
      "don't manufacture a marginal add just to have something to say.\n\n" +
      "Watchlist AND discovery players deserve real evaluation every run, not just a " +
      "mention — that's the entire point of tracking them: catching a good add " +
      "BEFORE the whole league is bidding on them, not waiting until they're already " +
      "trending. Discovery players specifically are the ones raw Sleeper add-counts " +
      "would miss entirely — treat a strong discovery find as at least as valuable " +
      "as a trending one, since by the time something trends, the value of grabbing " +
      "it first is already gone. If a watchlist or discovery player is genuinely " +
      "worth adding now, recommend it like any other add. If they're not worth " +
      "adding yet, say briefly why (e.g. role still unclear, not worth the roster " +
      "spot yet) so the user knows you actually looked.\n\n" +
      "A player also appearing in the trending-DROP data (platform-wide, not this " +
      "user's roster) is a real signal, not noise — for a bench player you're " +
      "weighing as a dropCandidate, other managers already cutting them is " +
      "corroborating evidence FOR the drop; for an add candidate, notable drops " +
      "elsewhere are worth flagging as a reason to double-check why (bye week vs. a " +
      "real problem) rather than trusting raw add momentum blindly.\n\n" +
      "A waiver claim is a SEASON-LONG decision, not just this week's: once the drop " +
      "candidate hits waivers, another team will very likely claim them and they're " +
      "gone for the rest of the season. Every recommendation needs a distinct " +
      "restOfSeasonOutlook that answers: is this add a genuine season-long asset (role " +
      "change, injury to the starter ahead of them, volume that sticks) or just a " +
      "short-term streamer (one favorable matchup, temporary fill-in)? And is the " +
      "dropCandidate someone whose remaining season value is genuinely lower than the " +
      "add — not just someone having one bad week? Don't recommend giving up a " +
      "long-term asset for a short-term streamer.\n\n" +
      "CRITICAL: only state a specific factual claim about a player's current depth-" +
      "chart position, role, or snap share (e.g. 'WR2', 'backup', 'starter') if it's " +
      "backed by the research provided below. If the research doesn't cover a " +
      "player's current role, say so explicitly or speak in general terms — do NOT " +
      "state a specific depth-chart ranking from memory, since your training data " +
      "may be outdated and a wrong claim here misleads a real roster decision.\n\n" +
      "The user may have written their own reasoning for holding specific players " +
      "(e.g. a backup QB they're stashing as a handcuff), or told you they're OPEN " +
      "to dropping or trading someone. Both are signal, not just context to " +
      "acknowledge: a 'still holding for X reason' note means make sure your case " +
      "for dropping them clears that bar before you recommend it; an 'OK dropping " +
      "him' note is a green light — actively look for the best available replacement " +
      "for that exact player and commit to the pairing (addPlayer + dropCandidate) " +
      "if anything on the wire or watchlist is a plausible fit, rather than " +
      "defaulting to a vague 'droppable when something better comes along.' Only " +
      "fall back to a pure note-response entry (below) when you've genuinely looked " +
      "and NOTHING available is worth the swap yet — and even then, state that as a " +
      "decisive verdict ('nothing on the wire beats him yet — hold') not a hedge.\n\n" +
      "A pure note-response entry — no real add/drop attached, just addressing a " +
      "note or directive directly — omits addPlayer, dropCandidate, AND " +
      "restOfSeasonOutlook entirely (don't write 'N/A' or invent a value for any of " +
      "them). Use this only when there's genuinely no actionable pairing to make; " +
      "don't use it as a default instead of doing the work of finding a real add or " +
      "drop.\n\n" +
      "Every title must read as a directive, not a status update — 'Add X, drop Y' " +
      "or 'Drop X now — don't wait' or 'Hold X, he's trade bait not a cut,' never " +
      "'Monitor X' or 'X is droppable if a need emerges.'" +
      buildCoachDirective(),
    prompt:
      `Roster positions required (note SUPER_FLEX/FLEX slots affect position value — ` +
      `e.g. a league with SUPER_FLEX values QBs much more highly than a standard ` +
      `1-QB league): ${JSON.stringify(ctx.rosterPositions)}\n` +
      `My roster (week ${week}):\n${rosterSummary}\n\n` +
      `${rosterStatusLine}` +
      notesSummary +
      buildTeamStrategySummary(ctx.teamStrategyNotes) +
      `\n\nTrending free agents available in my league:\n${trendingSummary}` +
      (watchlistSummary
        ? `\n\nMy watchlist (evaluate these regardless of trending status):\n${watchlistSummary}`
        : "") +
      (discoverySummary
        ? `\n\nAdditional options surfaced by broader research, not yet on the trending list:\n${discoverySummary}`
        : "") +
      researchContext +
      `\n\nReturn JSON: { "recommendations": [{ "title": string, "reasoning": string, ` +
      `"restOfSeasonOutlook": string (required when addPlayer is present), ` +
      `"addPlayer": string (optional — omit for a pure note response), ` +
      `"dropCandidate": string (optional) }] }. ` +
      `Rank by fit for my roster, not just raw popularity.`,
    schema: buildWaiverOutputSchema(rosterIsFull),
  });

  if (!llmResult.ok) return llmResult;

  const insertResult = await replacePendingRecommendations(ctx.db, {
    userId: ctx.userId,
    leagueId: ctx.leagueId,
    category: "waiver",
    week,
    rows: llmResult.data.recommendations.map((r) => {
      const resolvedDrop = r.dropCandidate
        ? resolveDropCandidate(r.dropCandidate, benchNames)
        : null;
      if (r.dropCandidate && !resolvedDrop) {
        console.warn(
          `[waiver-research] dropCandidate "${r.dropCandidate}" didn't match any bench player — kept as-is, unverified`,
        );
      }
      const finalDrop = resolvedDrop ?? r.dropCandidate;
      return {
        title: r.title,
        reasoning: r.reasoning,
        sources,
        payload: {
          ...(r.addPlayer ? { addPlayer: r.addPlayer } : {}),
          ...(finalDrop ? { dropCandidate: finalDrop, dropCandidateVerified: resolvedDrop !== null } : {}),
          ...(r.restOfSeasonOutlook ? { restOfSeasonOutlook: r.restOfSeasonOutlook } : {}),
        },
      };
    }),
  });

  if (!insertResult.ok) return insertResult;
  return { ok: true, data: { recommendationCount: insertResult.data } };
}
