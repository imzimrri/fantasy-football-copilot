// Shared TypeScript types mirroring the Supabase schema (camelCase — see
// project_context.md for the snake_case DB / camelCase TS mapping rule).

export interface League {
  id: string;
  sleeperLeagueId: string;
  name: string | null;
  season: string | null;
  scoringSettings: Record<string, number> | null;
  rosterPositions: string[] | null;
  settings: Record<string, unknown> | null;
}

export interface Roster {
  id: string;
  leagueId: string;
  sleeperRosterId: number;
  sleeperOwnerId: string | null;
  isOwnTeam: boolean;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface RosterPlayer {
  id: string;
  rosterId: string;
  sleeperPlayerId: string;
  rosterSlot: string | null;
  isStarter: boolean;
}

export interface Player {
  sleeperPlayerId: string;
  fullName: string | null;
  position: string | null;
  team: string | null;
  status: string | null;
}

export interface Matchup {
  id: string;
  leagueId: string;
  week: number;
  rosterId: string;
  opponentRosterId: string | null;
  points: number | null;
  opponentPoints: number | null;
}

export type RecommendationCategory = "start_sit" | "waiver" | "trade" | "news" | "matchup";
export type RecommendationStatus =
  | "pending"
  | "followed"
  | "not_followed"
  | "dismissed";

export interface RecommendationSource {
  title: string;
  url: string;
}

export interface Recommendation {
  id: string;
  leagueId: string;
  category: RecommendationCategory;
  week: number | null;
  title: string;
  reasoning: string;
  sources: RecommendationSource[];
  payload: Record<string, unknown>;
  status: RecommendationStatus;
  createdAt: string;
}

/** Maps a raw `recommendations` row (snake_case) to the camelCase app type. */
export function mapRecommendationRow(row: {
  id: string;
  league_id: string;
  category: string;
  week: number | null;
  title: string;
  reasoning: string;
  sources: RecommendationSource[] | null;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
}): Recommendation {
  return {
    id: row.id,
    leagueId: row.league_id,
    category: row.category as RecommendationCategory,
    week: row.week,
    title: row.title,
    reasoning: row.reasoning,
    sources: row.sources ?? [],
    payload: row.payload,
    status: row.status as RecommendationStatus,
    createdAt: row.created_at,
  };
}

export type RosterMoveType = "waiver" | "free_agent";

export interface RosterMove {
  id: string;
  leagueId: string;
  type: RosterMoveType;
  status: string;
  week: number;
  adds: Record<string, unknown>;
  drops: Record<string, unknown>;
  matchedRecommendationId: string | null;
  createdAt: string;
}

/** Maps a raw `roster_moves` row (snake_case) to the camelCase app type. */
export function mapRosterMoveRow(row: {
  id: string;
  league_id: string;
  type: string;
  status: string;
  week: number;
  adds: Record<string, unknown>;
  drops: Record<string, unknown>;
  matched_recommendation_id: string | null;
  created_at: string;
}): RosterMove {
  return {
    id: row.id,
    leagueId: row.league_id,
    type: row.type as RosterMoveType,
    status: row.status,
    week: row.week,
    adds: row.adds ?? {},
    drops: row.drops ?? {},
    matchedRecommendationId: row.matched_recommendation_id,
    createdAt: row.created_at,
  };
}
