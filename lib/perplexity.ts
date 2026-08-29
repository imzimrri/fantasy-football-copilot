import OpenAI from "openai";
import type { Result } from "@/lib/sleeper";
import { cacheKey, getCached, setCached } from "@/lib/cache";

// News/injury context is unlikely to meaningfully change within a few hours — caching
// here directly serves the "don't re-spend tokens re-fetching the same thing" cost
// constraint, especially during repeated agent runs while testing.
const RESEARCH_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface ResearchSource {
  title: string;
  url: string;
}

export interface ResearchResult {
  answer: string;
  sources: ResearchSource[];
}

// Cheapest Sonar tier — matches the cost-conscious constraint from the PRD. Override
// with PERPLEXITY_MODEL (e.g. "sonar-pro") for deeper multi-source research if needed.
const DEFAULT_MODEL = "sonar";

/**
 * Only http(s) URLs are safe to store/render as a clickable link — a `javascript:` (or
 * other non-http scheme) URL from an untrusted API response could execute on click.
 * Filter here so a malformed/malicious URL never reaches storage, not just the UI.
 */
function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Search-grounded research via Perplexity's Sonar API (OpenAI-compatible endpoint).
 * This is what makes agent reasoning answer "where" (real, current, cited sources),
 * not just "why" — the answer/sources returned here get folded into the LLM prompt
 * that generates the actual recommendation, and the sources are stored alongside it.
 */
export async function research(query: string): Promise<Result<ResearchResult>> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return { ok: false, error: "PERPLEXITY_API_KEY is not set" };

  // `||` not `??` — same reasoning as ANTHROPIC_MODEL in lib/llm.ts: an empty-string
  // env var must fall through to the default.
  const model = process.env.PERPLEXITY_MODEL || DEFAULT_MODEL;
  const key = cacheKey(["perplexity", model, query]);
  const cached = await getCached<ResearchResult>(key, RESEARCH_CACHE_TTL_MS);
  if (cached) return { ok: true, data: cached };

  try {
    const client = new OpenAI({ apiKey, baseURL: "https://api.perplexity.ai" });
    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: query }],
    });

    const answer = completion.choices[0]?.message?.content ?? "";

    // Perplexity extends the OpenAI response shape with `citations` (plain URLs) and,
    // on some models, a richer `search_results` array ({title, url, date}). Neither
    // is part of the `openai` SDK's typed response, so read both defensively rather
    // than assume one is always present.
    const raw = completion as unknown as {
      citations?: string[];
      search_results?: { title?: string; url: string }[];
    };
    // Sonar can return 15-20+ sources for one query — cap to the top few (already
    // relevance-ranked by the API) so a recommendation card doesn't drown in links.
    const MAX_SOURCES = 5;
    const sources: ResearchSource[] = (
      raw.search_results && raw.search_results.length > 0
        ? raw.search_results.map((r) => ({ title: r.title ?? r.url, url: r.url }))
        : (raw.citations ?? []).map((url) => ({ title: url, url }))
    )
      .filter((source) => isSafeHttpUrl(source.url))
      .slice(0, MAX_SOURCES);

    const result = { answer, sources };
    await setCached(key, result);
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: `Perplexity research failed: ${String(e)}` };
  }
}
