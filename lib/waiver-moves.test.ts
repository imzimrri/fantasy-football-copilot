import { describe, expect, it } from "vitest";
import { pointsFieldForLeague } from "@/lib/waiver-moves";

describe("pointsFieldForLeague", () => {
  it("uses pts_ppr for a full-PPR league", () => {
    expect(pointsFieldForLeague({ rec: 1 })).toBe("pts_ppr");
  });

  it("uses pts_std for a standard (non-PPR) league", () => {
    expect(pointsFieldForLeague({ rec: 0 })).toBe("pts_std");
  });

  it("uses pts_std when scoring settings are missing entirely", () => {
    expect(pointsFieldForLeague(null)).toBe("pts_std");
  });

  it("uses pts_half_ppr for a half-PPR league (this league's actual format)", () => {
    expect(pointsFieldForLeague({ rec: 0.5 })).toBe("pts_half_ppr");
  });
});
