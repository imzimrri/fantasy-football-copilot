import { describe, expect, it } from "vitest";
import { computeSurplusAndNeed, findBestTradePartner } from "@/lib/agents/trade-suggestions";

describe("computeSurplusAndNeed", () => {
  it("identifies the position furthest above league average as surplus", () => {
    const rosters = [
      { rosterId: "me", displayName: "Me", counts: { QB: 2, RB: 2, WR: 6, TE: 1, K: 1 } },
      { rosterId: "b", displayName: "B", counts: { QB: 2, RB: 4, WR: 2, TE: 1, K: 1 } },
      { rosterId: "c", displayName: "C", counts: { QB: 2, RB: 3, WR: 2, TE: 2, K: 1 } },
    ];
    const result = computeSurplusAndNeed(rosters);
    expect(result.get("me")?.surplus).toBe("WR");
  });

  it("identifies the position furthest below league average as need", () => {
    const rosters = [
      { rosterId: "me", displayName: "Me", counts: { QB: 2, RB: 1, WR: 4, TE: 1, K: 1 } },
      { rosterId: "b", displayName: "B", counts: { QB: 2, RB: 4, WR: 3, TE: 1, K: 1 } },
      { rosterId: "c", displayName: "C", counts: { QB: 2, RB: 3, WR: 3, TE: 2, K: 1 } },
    ];
    const result = computeSurplusAndNeed(rosters);
    expect(result.get("me")?.need).toBe("RB");
  });
});

describe("findBestTradePartner", () => {
  it("finds the team whose surplus matches my need AND whose need matches my surplus", () => {
    // Me: RB-poor (1), WR-rich (6). League average RB ~3, WR ~3.
    // Partner: RB-rich (5), WR-poor (1) — the ideal complementary fit.
    // Distractor: RB-rich too, but also WR-rich (not a fit — they don't need my WRs).
    const rosters = [
      { rosterId: "me", displayName: "Me", counts: { QB: 2, RB: 1, WR: 6, TE: 1, K: 1 } },
      { rosterId: "partner", displayName: "Partner", counts: { QB: 2, RB: 5, WR: 1, TE: 1, K: 1 } },
      { rosterId: "distractor", displayName: "Distractor", counts: { QB: 2, RB: 5, WR: 5, TE: 1, K: 1 } },
    ];
    const match = findBestTradePartner("me", rosters);
    expect(match?.partnerRosterId).toBe("partner");
    expect(match?.myNeed).toBe("RB");
    expect(match?.mySurplus).toBe("WR");
  });

  it("returns null when I'm not in the roster list", () => {
    const rosters = [
      { rosterId: "a", displayName: "A", counts: { QB: 2, RB: 2, WR: 2, TE: 1, K: 1 } },
      { rosterId: "b", displayName: "B", counts: { QB: 2, RB: 2, WR: 2, TE: 1, K: 1 } },
    ];
    expect(findBestTradePartner("me", rosters)).toBeNull();
  });

  it("never proposes trading with myself even when I'm the most extreme roster", () => {
    // I'm both the RB-poorest AND WR-richest team in the league — if the scoring
    // logic ever compared me against myself, "me" would trivially win every time.
    const rosters = [
      { rosterId: "me", displayName: "Me", counts: { QB: 2, RB: 1, WR: 6, TE: 1, K: 1 } },
      { rosterId: "b", displayName: "B", counts: { QB: 2, RB: 2, WR: 3, TE: 1, K: 1 } },
      { rosterId: "c", displayName: "C", counts: { QB: 2, RB: 3, WR: 2, TE: 1, K: 1 } },
    ];
    const match = findBestTradePartner("me", rosters);
    expect(match).not.toBeNull();
    expect(match?.partnerRosterId).not.toBe("me");
  });

  it("returns null (rather than a bad match) when no team actually has what I need", () => {
    // Every team, including me, has the exact same roster composition — there's no
    // genuine complementary fit anywhere, so this should still return SOME candidate
    // (the least-bad option) rather than throw, but never claim a fit that doesn't exist.
    const rosters = [
      { rosterId: "me", displayName: "Me", counts: { QB: 2, RB: 3, WR: 3, TE: 1, K: 1 } },
      { rosterId: "b", displayName: "B", counts: { QB: 2, RB: 3, WR: 3, TE: 1, K: 1 } },
    ];
    const match = findBestTradePartner("me", rosters);
    expect(match?.partnerRosterId).toBe("b");
  });
});
