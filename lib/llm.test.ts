import { describe, expect, it } from "vitest";
import { z } from "zod";
import { escapeControlCharactersInStrings, parseAndValidateJson } from "@/lib/llm";

const schema = z.object({
  recommendations: z.array(z.object({ title: z.string(), reasoning: z.string() })),
});

describe("parseAndValidateJson", () => {
  it("parses clean JSON matching the schema", () => {
    const result = parseAndValidateJson(
      JSON.stringify({ recommendations: [{ title: "Start X", reasoning: "Because Y" }] }),
      schema,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.recommendations).toHaveLength(1);
      expect(result.data.recommendations[0].title).toBe("Start X");
    }
  });

  it("strips a markdown code fence the model added despite instructions", () => {
    const fenced = "```json\n" + JSON.stringify({ recommendations: [] }) + "\n```";
    const result = parseAndValidateJson(fenced, schema);
    expect(result.ok).toBe(true);
  });

  it("returns ok:false for invalid JSON instead of throwing", () => {
    const result = parseAndValidateJson("not json at all", schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not valid JSON");
    }
  });

  it("returns ok:false when JSON is valid but doesn't match the schema", () => {
    const result = parseAndValidateJson(JSON.stringify({ wrong: "shape" }), schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("schema validation");
    }
  });

  it("never lets a recommendation through without required fields", () => {
    const missingReasoning = JSON.stringify({
      recommendations: [{ title: "Start X" }],
    });
    const result = parseAndValidateJson(missingReasoning, schema);
    expect(result.ok).toBe(false);
  });

  it("tolerates a raw newline inside a string value (real bug: a multi-line chat reply)", () => {
    // Deliberately NOT JSON.stringify'd — a real literal newline byte inside the
    // string, which is what a model actually emits and JSON.stringify would never
    // produce (it always escapes to \n).
    const broken =
      '{"recommendations": [{"title": "Start X", "reasoning": "Line one.\nLine two."}]}';
    const result = parseAndValidateJson(broken, schema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.recommendations[0].reasoning).toBe("Line one.\nLine two.");
    }
  });
});

describe("escapeControlCharactersInStrings", () => {
  it("escapes a raw newline/tab/carriage-return inside a string", () => {
    const input = '{"a": "one\ntwo\tthree\rfour"}';
    expect(escapeControlCharactersInStrings(input)).toBe(
      '{"a": "one\\ntwo\\tthree\\rfour"}',
    );
  });

  it("leaves structural whitespace between tokens untouched", () => {
    const input = '{\n  "a": "b"\n}';
    expect(escapeControlCharactersInStrings(input)).toBe(input);
  });

  it("doesn't re-escape an already-escaped sequence", () => {
    const input = '{"a": "one\\ntwo"}';
    expect(escapeControlCharactersInStrings(input)).toBe(input);
  });

  it("leaves a quote escaped inside a string alone (doesn't exit string state early)", () => {
    const input = '{"a": "she said \\"hi\\"\nnext line"}';
    expect(escapeControlCharactersInStrings(input)).toBe(
      '{"a": "she said \\"hi\\"\\nnext line"}',
    );
  });
});
