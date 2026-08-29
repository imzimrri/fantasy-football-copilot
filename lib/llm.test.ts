import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseAndValidateJson } from "@/lib/llm";

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
});
