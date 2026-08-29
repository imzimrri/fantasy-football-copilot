import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { z } from "zod";
import { cacheKey, getCached, setCached } from "@/lib/cache";

// Shorter than the Perplexity research cache (project decisions change faster than
// news does) but still meaningfully cuts spend on repeated agent runs against
// unchanged data — the prompt itself encodes roster/research state, so a real data
// change produces a different prompt and thus a cache miss; this only ever reuses a
// response for a genuinely identical request.
const LLM_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export type LlmProvider = "anthropic" | "openrouter";

export interface GenerateOptions {
  system: string;
  prompt: string;
  /** Defaults to whichever provider has an API key configured (Anthropic preferred). */
  provider?: LlmProvider;
  /** Defaults to ANTHROPIC_MODEL / OPENROUTER_MODEL env vars — set those per task. */
  model?: string;
  maxTokens?: number;
}

// Verified current, cheap-tier Claude model (see architecture.md) — used only when
// ANTHROPIC_MODEL isn't set. There is no safe default for OPENROUTER_MODEL since
// available OpenRouter model slugs change frequently — set it explicitly per task.
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

function resolveProvider(requested?: LlmProvider): LlmProvider {
  if (requested) return requested;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  throw new Error(
    "No LLM provider configured — set ANTHROPIC_API_KEY and/or OPENROUTER_API_KEY",
  );
}

async function callAnthropic(opts: GenerateOptions): Promise<Result<string>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY is not set" };

  try {
    // Identity-linked (org/SSO-issued) API keys require this header explicitly — the
    // SDK does NOT auto-forward ANTHROPIC_WORKSPACE_ID as a request header for plain
    // apiKey auth (that env var only feeds the separate WIF credential-exchange flow).
    // Confirmed by testing directly against the API — see project_context.md.
    const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
    const client = new Anthropic({
      apiKey,
      ...(workspaceId && { defaultHeaders: { "anthropic-workspace-id": workspaceId } }),
    });
    // `||` not `??` — an empty-string env var (e.g. `ANTHROPIC_MODEL=` left blank in
    // .env.example) must fall through to the default, and `??` only catches
    // null/undefined, not "".
    const model = opts.model || process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
    const message = await client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 2048,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
    });
    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { ok: false, error: "Anthropic response contained no text block" };
    }
    return { ok: true, data: textBlock.text };
  } catch (e) {
    return { ok: false, error: `Anthropic call failed: ${String(e)}` };
  }
}

async function callOpenRouter(opts: GenerateOptions): Promise<Result<string>> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { ok: false, error: "OPENROUTER_API_KEY is not set" };

  const model = opts.model ?? process.env.OPENROUTER_MODEL;
  if (!model) {
    return {
      ok: false,
      error: "No model specified for OpenRouter — pass `model` or set OPENROUTER_MODEL",
    };
  }

  try {
    const client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
    });
    const completion = await client.chat.completions.create({
      model,
      max_tokens: opts.maxTokens ?? 2048,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.prompt },
      ],
    });
    const text = completion.choices[0]?.message?.content;
    if (!text) return { ok: false, error: "OpenRouter response contained no text" };
    return { ok: true, data: text };
  } catch (e) {
    return { ok: false, error: `OpenRouter call failed: ${String(e)}` };
  }
}

/** Generate plain text from the configured/requested LLM provider. Cached — see LLM_CACHE_TTL_MS. */
export async function generateText(opts: GenerateOptions): Promise<Result<string>> {
  let provider: LlmProvider;
  try {
    provider = resolveProvider(opts.provider);
  } catch (e) {
    return { ok: false, error: String(e) };
  }

  const key = cacheKey([
    "llm",
    provider,
    opts.model ?? "",
    String(opts.maxTokens ?? ""),
    opts.system,
    opts.prompt,
  ]);
  const cached = await getCached<string>(key, LLM_CACHE_TTL_MS);
  if (cached !== null) return { ok: true, data: cached };

  const result = provider === "anthropic" ? await callAnthropic(opts) : await callOpenRouter(opts);
  if (result.ok) await setCached(key, result.data);
  return result;
}

/**
 * Parses raw LLM text as JSON and validates it against `schema`. Pure/no I/O — split
 * out from `generateJSON` specifically so it's unit-testable without mocking an SDK.
 * Strips a markdown code fence if the model wrapped its JSON in one despite instructions.
 */
export function parseAndValidateJson<T>(
  text: string,
  schema: z.ZodType<T>,
): Result<T> {
  let parsed: unknown;
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return { ok: false, error: `LLM response was not valid JSON: ${String(e)}` };
  }

  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    console.warn("[llm] schema validation failed on:", JSON.stringify(parsed, null, 2));
    return {
      ok: false,
      error: `LLM JSON failed schema validation: ${validated.error.message}`,
    };
  }
  return { ok: true, data: validated.data };
}

/**
 * Generate JSON matching `schema`. Instructs the model to return only JSON, then
 * validates the result — this is the mechanism behind every agent's structured
 * recommendation output (including the required `reasoning` field).
 */
export async function generateJSON<T>(
  opts: GenerateOptions & { schema: z.ZodType<T> },
): Promise<Result<T>> {
  const jsonSystem = `${opts.system}\n\nRespond with ONLY valid JSON — no prose, no markdown code fences, no explanation outside the JSON structure.`;
  const textResult = await generateText({ ...opts, system: jsonSystem });
  if (!textResult.ok) return textResult;
  return parseAndValidateJson(textResult.data, opts.schema);
}
