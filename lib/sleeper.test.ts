import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLeague,
  getUserByUsername,
  resolveFantasyWeek,
  resolveLastCompletedWeek,
} from "@/lib/sleeper";

function mockFetchOnce(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getUserByUsername", () => {
  it("returns ok:true with parsed data on a valid response", async () => {
    mockFetchOnce({ user_id: "123", username: "zgudino" });
    const result = await getUserByUsername("zgudino");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.user_id).toBe("123");
  });

  it("returns ok:false (never throws) on a non-OK HTTP status", async () => {
    mockFetchOnce({}, 404);
    const result = await getUserByUsername("does-not-exist");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("404");
  });

  it("returns ok:false when the response fails schema validation", async () => {
    mockFetchOnce({ unexpected: "shape" });
    const result = await getUserByUsername("zgudino");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("failed validation");
  });

  it("returns ok:false (never throws) if fetch itself rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await getUserByUsername("zgudino");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("network down");
  });
});

describe("getLeague", () => {
  it("parses a realistic league payload", async () => {
    mockFetchOnce({
      league_id: "1354586156884299776",
      name: "Cockmans",
      season: "2026",
      scoring_settings: { rec: 0.5 },
      roster_positions: ["QB", "RB", "WR"],
      settings: { num_teams: 12 },
    });
    const result = await getLeague("1354586156884299776");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe("Cockmans");
      expect(result.data.scoring_settings.rec).toBe(0.5);
    }
  });
});

describe("resolveFantasyWeek", () => {
  it("clamps to week 1 during preseason, regardless of the NFL's own preseason week count", () => {
    // Real bug, reproduced: Sleeper returned exactly this during 2026 preseason —
    // using state.week directly mistagged everything as "week 3" before kickoff.
    expect(resolveFantasyWeek({ week: 3, season_type: "pre" })).toBe(1);
  });

  it("clamps to week 1 in the offseason too", () => {
    expect(resolveFantasyWeek({ week: 17, season_type: "off" })).toBe(1);
  });

  it("uses the raw week once the regular season is underway", () => {
    expect(resolveFantasyWeek({ week: 5, season_type: "regular" })).toBe(5);
  });

  it("uses the raw week during the postseason (fantasy playoffs continue the counter)", () => {
    expect(resolveFantasyWeek({ week: 16, season_type: "post" })).toBe(16);
  });
});

describe("resolveLastCompletedWeek", () => {
  it("is 0 during preseason — nothing has been played yet", () => {
    expect(resolveLastCompletedWeek({ week: 3, season_type: "pre" })).toBe(0);
  });

  it("is 0 in the offseason too", () => {
    expect(resolveLastCompletedWeek({ week: 17, season_type: "off" })).toBe(0);
  });

  it("is one behind the current week during the regular season (never the in-progress week)", () => {
    expect(resolveLastCompletedWeek({ week: 5, season_type: "regular" })).toBe(4);
  });

  it("never goes negative on week 1 of the regular season", () => {
    expect(resolveLastCompletedWeek({ week: 1, season_type: "regular" })).toBe(0);
  });
});
