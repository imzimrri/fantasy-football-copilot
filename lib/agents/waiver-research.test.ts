import { describe, expect, it } from "vitest";
import { resolveDropCandidate } from "@/lib/agents/waiver-research";

const BENCH = ["Justin Fields", "Mark Andrews", "Khalil Shakir", "Dylan Sampson"];

describe("resolveDropCandidate", () => {
  it("matches an exact bench name", () => {
    expect(resolveDropCandidate("Mark Andrews", BENCH)).toBe("Mark Andrews");
  });

  it("matches case-insensitively and trims whitespace", () => {
    expect(resolveDropCandidate("  mark andrews ", BENCH)).toBe("Mark Andrews");
  });

  it("matches when the model appends extra context (e.g. a position tag)", () => {
    expect(resolveDropCandidate("Justin Fields (QB)", BENCH)).toBe("Justin Fields");
  });

  it("matches when the model shortens the name to a substring of a bench name", () => {
    expect(resolveDropCandidate("Khalil Shakir", BENCH)).toBe("Khalil Shakir");
  });

  it("returns null for a player genuinely not on the bench (never trusts a bad pick)", () => {
    expect(resolveDropCandidate("Patrick Mahomes", BENCH)).toBeNull();
  });

  it("returns null for an empty bench (nothing to match against)", () => {
    expect(resolveDropCandidate("Mark Andrews", [])).toBeNull();
  });
});
