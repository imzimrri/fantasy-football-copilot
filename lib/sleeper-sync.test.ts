import { describe, expect, it } from "vitest";
import { weeksToSync } from "@/lib/sleeper-sync";

describe("weeksToSync", () => {
  it("syncs every regular-season week on a full sync", () => {
    expect(weeksToSync("full", 14, 6)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it("syncs only last and this week on a current-week sync", () => {
    expect(weeksToSync("current", 14, 6)).toEqual([5, 6]);
  });

  it("clamps to week 1 at the start of the season", () => {
    expect(weeksToSync("current", 14, 1)).toEqual([1]);
  });

  it("clamps to the regular season during the playoffs", () => {
    expect(weeksToSync("current", 14, 16)).toEqual([]);
    expect(weeksToSync("current", 14, 15)).toEqual([14]);
  });

  it("falls back to a full range when the current week is unknown", () => {
    expect(weeksToSync("current", 3, null)).toEqual([1, 2, 3]);
  });
});
