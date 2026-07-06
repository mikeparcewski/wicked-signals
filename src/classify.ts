/**
 * wicked-signals v0.1 — LLM classification via Anthropic API
 *
 * v0.1 single-model mode:
 * - Uses claude-haiku-4-5-20251001
 * - Confidence capped at 0.80 (degraded mode)
 * - ANTHROPIC_API_KEY required
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ClassificationResult, ClassificationType, CrewType } from './types.js';

const DEGRADED_CONFIDENCE_CAP = 0.80;
const MODEL_ID = 'claude-haiku-4-5-20251001';

// Warn to stderr once per process
let _warnedDegraded = false;

function warnDegraded(): void {
  if (!_warnedDegraded) {
    process.stderr.write(
      'WARN: degraded mode active — auto-launch disabled (confidence capped at 0.80)\n',
    );
    _warnedDegraded = true;
  }
}

const CLASSIFICATION_SYSTEM_PROMPT = `You are a signal classifier for the wicked-* ecosystem. Your job is to classify an input signal into exactly one routing category and return ONLY valid JSON with no markdown, no explanation, no code fences.

Classification types:
- "crew-launch": Requires a multi-step workflow (crew). Use crew_type: feature|spike|analysis|knowledge|ops|brainstorm
- "direct": Can be answered inline (summary, analysis, short answer, explanation) without launching a workflow
- "garden-action": Requires a wicked-garden CLI command or plugin action

Return ONLY this JSON object (no other text):
{
  "type": "crew-launch" | "direct" | "garden-action",
  "crew_type": "feature" | "spike" | "analysis" | "knowledge" | "ops" | "brainstorm" | null,
  "confidence": <number between 0.0 and 0.8>,
  "resolved_text": "<full answer if type=direct, omit otherwise>",
  "rationale": "<brief explanation of your classification>"
}

Rules:
- confidence must be between 0.0 and 0.8 (never exceed 0.8 in v0.1)
- crew_type must be null if type is not "crew-launch"
- resolved_text must be included (and be a complete, useful answer) if type is "direct"
- resolved_text must be omitted if type is "crew-launch" or "garden-action"`;

function buildUserPrompt(content: string): string {
  return `Classify this input signal:\n\n${content}`;
}

interface RawLLMResponse {
  type?: unknown;
  crew_type?: unknown;
  confidence?: unknown;
  resolved_text?: unknown;
  rationale?: unknown;
}

function parseAndValidateResponse(raw: string): ClassificationResult {
  let parsed: RawLLMResponse;
  try {
    // Strip potential markdown fences just in case
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned) as RawLLMResponse;
  } catch {
    throw new Error(`Failed to parse LLM classification response as JSON: ${raw.slice(0, 200)}`);
  }

  const validTypes: ClassificationType[] = ['crew-launch', 'direct', 'garden-action'];
  if (!parsed.type || !validTypes.includes(parsed.type as ClassificationType)) {
    throw new Error(`Invalid classification type: ${String(parsed.type)}`);
  }

  const type = parsed.type as ClassificationType;

  const validCrewTypes: (CrewType | null)[] = [
    'feature', 'spike', 'analysis', 'knowledge', 'ops', 'brainstorm', null,
  ];
  const crewTypeRaw = parsed.crew_type ?? null;
  if (!validCrewTypes.includes(crewTypeRaw as CrewType | null)) {
    throw new Error(`Invalid crew_type: ${String(crewTypeRaw)}`);
  }
  const crew_type = crewTypeRaw as CrewType | null;

  const rawConfidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
  // Cap confidence at DEGRADED_CONFIDENCE_CAP
  const confidence = Math.min(rawConfidence, DEGRADED_CONFIDENCE_CAP);

  const rationale =
    typeof parsed.rationale === 'string' ? parsed.rationale : 'No rationale provided';

  const result: ClassificationResult = { type, crew_type, confidence, rationale };

  if (type === 'direct' && typeof parsed.resolved_text === 'string') {
    result.resolved_text = parsed.resolved_text;
  }

  return result;
}

/**
 * Classify signal content using the Anthropic API.
 * Always runs in degraded mode (v0.1): confidence capped at 0.80.
 * Throws if ANTHROPIC_API_KEY is not set.
 */
export async function classifySignal(content: string): Promise<{
  result: ClassificationResult;
  modelId: string;
  degraded: boolean;
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Error: ANTHROPIC_API_KEY is not set');
  }

  warnDegraded();

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: MODEL_ID,
    max_tokens: 1024,
    system: CLASSIFICATION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: buildUserPrompt(content),
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text content in LLM response');
  }

  const result = parseAndValidateResponse(textBlock.text);

  return {
    result,
    modelId: MODEL_ID,
    degraded: true, // Always true in v0.1
  };
}

/** Determine confidence tier from score */
export function getConfidenceTier(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.85) return 'high';
  if (score >= 0.6) return 'medium';
  return 'low';
}

/** Reset degraded warning state (for testing) */
export function resetDegradedWarning(): void {
  _warnedDegraded = false;
}
