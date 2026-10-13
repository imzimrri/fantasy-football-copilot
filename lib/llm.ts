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
      // Real bug hit live: a large prompt (chat's roster+notes+waiver+news+research+
      // history context) combined with maxTokens too small for the model's actual
      // response cut the completion off before any text block was written — the
      // content array held only a partial/other block type. stop_reason and the
      // block types actually present are the fastest way to tell that apart from a
      // genuine empty response.
      const blockTypes = message.content.map((block) => block.type).join(", ") || "none";
      return {
        ok: false,
        error:
          `Anthropic response contained no text block (stop_reason: ${message.stop_reason}, ` +
          `blocks: [${blockTypes}]) — likely maxTokens too low for this prompt/model`,
      };
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
 * Repairs common ways a model's "JSON" fails strict `JSON.parse` despite being told
 * to return only JSON — both reliably show up in a long, prose-heavy field (chat's
 * multi-paragraph `reply` especially), not in the simpler fields every other agent
 * writes:
 *
 * 1. A raw control character (a literal newline/tab/carriage-return byte typed
 *    directly into the text instead of escaped) inside a string value — illegal per
 *    the JSON spec. Real bug hit live: "Bad control character in string literal."
 * 2. A literal `"` INSIDE a string's own content that the model forgot to escape as
 *    `\"` (quoting a nickname, a stat label, etc.) — this makes a naive parser treat
 *    it as the string's end, then fail on whatever comes after, which is what
 *    produced the next bug hit live: "Unterminated string in JSON" far later in the
 *    text, from the SAME root cause (an earlier stray quote, not a truncated
 *    response).
 *
 * Tracks string state by toggling on quotes, but for case 2 specifically: before
 * treating a `"` as the REAL end of a string, look ahead past any whitespace for a
 * structural character that legally follows a JSON string (`,` `}` `]` `:`, or end of
 * input). If what follows isn't one of those, this wasn't a real closing quote —
 * escape it and stay inside the string instead. This is the same heuristic
 * JSON-repair tooling generally uses; it isn't foolproof against every pathological
 * case, but it fixes exactly the shape of mistake a model actually makes here.
 */
export function repairLlmJsonText(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) {
      if (ch === '"') inString = true;
      result += ch;
      continue;
    }
    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      result += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      const next = text[j];
      const isRealEnd = next === undefined || ",}]:".includes(next);
      if (isRealEnd) {
        inString = false;
        result += ch;
      } else {
        result += '\\"';
      }
      continue;
    }
    if (ch.charCodeAt(0) < 0x20) {
      if (ch === "\n") result += "\\n";
      else if (ch === "\r") result += "\\r";
      else if (ch === "\t") result += "\\t";
      // else: drop other stray control characters — not valid JSON and not worth a
      // specific escape, vs. failing the whole parse over one odd character.
      continue;
    }
    result += ch;
  }
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
    const sanitized = repairLlmJsonText(cleaned);
    parsed = JSON.parse(sanitized);
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
 * Generate JSON matching `schema` via Anthropic's forced tool-use, NOT by asking the
 * model to type raw JSON text. This is the real fix for a class of bugs hit
 * repeatedly in production: a model asked to hand-type JSON reliably gets a long,
 * prose-heavy field wrong (an unescaped quote or a literal newline inside a string),
 * which `repairLlmJsonText` could only ever patch reactively, one malformation shape
 * at a time, and never fully close out. Tool-use sidesteps the whole class — the API
 * constructs the arguments as real structured data via constrained decoding; it never
 * hands back prose for us to re-parse, so there is no "typing JSON" step left to get
 * wrong. `schema.safeParse` on the result is still a real safety net (shape/type
 * correctness), just no longer a JSON-syntax one.
 */
async function callAnthropicStructured<T>(
  opts: GenerateOptions & { schema: z.ZodType<T> },
): Promise<Result<T>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY is not set" };

  const model = opts.model || process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
  const key = cacheKey([
    "llm-structured",
    model,
    String(opts.maxTokens ?? ""),
    opts.system,
    opts.prompt,
  ]);
  const cached = await getCached<unknown>(key, LLM_CACHE_TTL_MS);
  if (cached !== null) {
    // Only trust a cached value that still validates — never replay a bad cached
    // result just because it's cheap.
    const validatedCached = opts.schema.safeParse(cached);
    if (validatedCached.success) return { ok: true, data: validatedCached.data };
  }

  try {
    const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
    const client = new Anthropic({
      apiKey,
      ...(workspaceId && { defaultHeaders: { "anthropic-workspace-id": workspaceId } }),
    });

    // z.toJSONSchema drops refinements (e.g. a `.superRefine` cross-field check) —
    // those still apply below via `schema.safeParse`, same as before; only the
    // structural shape needs to reach Anthropic as a tool input_schema. `$schema`
    // is meaningless there, so it's stripped.
    const jsonSchema = z.toJSONSchema(opts.schema) as Record<string, unknown>;
    delete jsonSchema.$schema;

    const message = await client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 2048,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
      tools: [
        {
          name: "submit_result",
          description:
            "Submit the structured result for this request. This is the only way to respond.",
          // zod's JSON Schema output is structurally compatible with Anthropic's
          // Tool.InputSchema but typed too loosely on both sides to line up without a
          // cast.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          input_schema: jsonSchema as any,
        },
      ],
      tool_choice: { type: "tool", name: "submit_result" },
    });

    const toolUseBlock = message.content.find((block) => block.type === "tool_use");
    if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
      const blockTypes = message.content.map((block) => block.type).join(", ") || "none";
      return {
        ok: false,
        error:
          `Anthropic response contained no tool_use block (stop_reason: ${message.stop_reason}, ` +
          `blocks: [${blockTypes}]) — likely maxTokens too low for this prompt/model`,
      };
    }

    const validated = opts.schema.safeParse(toolUseBlock.input);
    if (!validated.success) {
      console.warn("[llm] schema validation failed on:", JSON.stringify(toolUseBlock.input, null, 2));
      return {
        ok: false,
        error: `LLM JSON failed schema validation: ${validated.error.message}`,
      };
    }

    await setCached(key, toolUseBlock.input);
    return { ok: true, data: validated.data };
  } catch (e) {
    return { ok: false, error: `Anthropic call failed: ${String(e)}` };
  }
}

/**
 * Generate JSON matching `schema`. On Anthropic, uses forced tool-use so the API
 * itself constructs valid structured output (see `callAnthropicStructured`) — no
 * JSON-syntax repair needed. OpenRouter has no such path wired up yet, so it falls
 * back to the older "ask the model to type raw JSON, then repair/validate it"
 * approach, defensively patched by `repairLlmJsonText`.
 */
export async function generateJSON<T>(
  opts: GenerateOptions & { schema: z.ZodType<T> },
): Promise<Result<T>> {
  let provider: LlmProvider;
  try {
    provider = resolveProvider(opts.provider);
  } catch (e) {
    return { ok: false, error: String(e) };
  }

  if (provider === "anthropic") {
    return callAnthropicStructured(opts);
  }

  const jsonSystem =
    `${opts.system}\n\nRespond with ONLY valid JSON — no prose, no markdown code ` +
    `fences, no explanation outside the JSON structure. Inside every string value, " ` +
    `must be escaped as \\" and a real line break must be written as \\n — never a ` +
    `literal unescaped quote or newline character, even when quoting a word/stat or ` +
    `writing a multi-paragraph answer.`;
  const textResult = await generateText({ ...opts, provider, system: jsonSystem });
  if (!textResult.ok) return textResult;
  return parseAndValidateJson(textResult.data, opts.schema);
}
