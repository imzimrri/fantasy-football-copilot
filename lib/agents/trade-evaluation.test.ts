import { describe, expect, it } from "vitest";
import { resolveTradeSides } from "@/lib/agents/trade-evaluation";

describe("resolveTradeSides", () => {
  // Realistic 2-team trade shape, matching what api.sleeper.app/v1/league/{id}/transactions
  // actually returns (verified live): player A moves roster 1 -> roster 2 shows up as
  // drops:{A:1}, adds:{A:2}.
  const MY_ROSTER = 6;
  const THEIR_ROSTER = 3;

  it("identifies players I receive (I appear as the destination roster in adds)", () => {
    const adds = { playerX: MY_ROSTER, playerY: THEIR_ROSTER };
    const drops = { playerY: MY_ROSTER, playerX: THEIR_ROSTER };
    const { receiving } = resolveTradeSides(adds, drops, MY_ROSTER);
    expect(receiving).toEqual(["playerX"]);
  });

  it("identifies players I give up (I appear as the source roster in drops)", () => {
    const adds = { playerX: MY_ROSTER, playerY: THEIR_ROSTER };
    const drops = { playerY: MY_ROSTER, playerX: THEIR_ROSTER };
    const { giving } = resolveTradeSides(adds, drops, MY_ROSTER);
    expect(giving).toEqual(["playerY"]);
  });

  it("handles a multi-player trade (2-for-1) correctly on both sides", () => {
    const adds = { playerA: MY_ROSTER, playerB: THEIR_ROSTER, playerC: THEIR_ROSTER };
    const drops = { playerA: THEIR_ROSTER, playerB: MY_ROSTER, playerC: MY_ROSTER };
    const { receiving, giving } = resolveTradeSides(adds, drops, MY_ROSTER);
    expect(receiving).toEqual(["playerA"]);
    expect(giving.sort()).toEqual(["playerB", "playerC"]);
  });

  it("never confuses giving for receiving even with a third uninvolved roster present", () => {
    // A 3-team trade where roster 9 is involved but not us.
    const adds = { playerX: MY_ROSTER, playerY: 9 };
    const drops = { playerX: THEIR_ROSTER, playerY: MY_ROSTER };
    const { receiving, giving } = resolveTradeSides(adds, drops, MY_ROSTER);
    expect(receiving).toEqual(["playerX"]);
    expect(giving).toEqual(["playerY"]);
  });

  it("returns empty arrays when I'm not actually involved in this trade", () => {
    const adds = { playerX: THEIR_ROSTER };
    const drops = { playerX: 9 };
    const { receiving, giving } = resolveTradeSides(adds, drops, MY_ROSTER);
    expect(receiving).toEqual([]);
    expect(giving).toEqual([]);
  });
});
