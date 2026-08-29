import { describe, expect, it } from "vitest";
import { fuzzyMatchName } from "@/lib/fuzzy-match";

const NAMES = ["Justin Fields", "Mark Andrews", "Khalil Shakir", "Dylan Sampson"];

describe("fuzzyMatchName", () => {
  it("matches an exact name", () => {
    expect(fuzzyMatchName("Mark Andrews", NAMES)).toBe("Mark Andrews");
  });

  it("matches case-insensitively and trims whitespace", () => {
    expect(fuzzyMatchName("  mark andrews ", NAMES)).toBe("Mark Andrews");
  });

  it("matches when extra context is appended (e.g. a position tag)", () => {
    expect(fuzzyMatchName("Justin Fields (QB)", NAMES)).toBe("Justin Fields");
  });

  it("returns null for a name genuinely not in the candidate list", () => {
    expect(fuzzyMatchName("Patrick Mahomes", NAMES)).toBeNull();
  });

  it("returns null for an empty candidate list", () => {
    expect(fuzzyMatchName("Mark Andrews", [])).toBeNull();
  });
});
