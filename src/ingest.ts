/**
 * wicked-signals v0.1 — Ingestion pipeline
 *
 * Handles text, file, and alert adapters.
 * Store-first: signal is written to SQLite BEFORE classification.
 * Classification failures leave signal in 'pending' status.
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  insertSignal,
  insertClassification,
  updateSignalStatus,
  setSignalClassifiedAt,
} from './db.js';
import { classifySignal, getConfidenceTier } from './classify.js';
import { routeSignal } from './route.js';
import { emitSignalReceived, emitSignalClassified } from './events.js';
import type { IngestResult, AlertNormalizedContent, SignalSource } from './types.js';

const TEXT_SIZE_LIMIT = 1024 * 1024; // 1MB
const FILE_SIZE_LIMIT = 10 * 1024 * 1024; // 10MB

export interface StructuredError {
  error: string;
  code: string;
}

function structuredError(message: string, code: string): StructuredError {
  return { error: message, code };
}

/**
 * Normalize raw content for classification.
 * Strips excessive whitespace, truncates to safe length.
 */
function normalize(raw: string): string {
  return raw.trim().replace(/\s{3,}/g, '\n\n').slice(0, 8000);
}

/**
 * Generate a stable idempotency key for ingest based on content hash.
 * Format: signals:signal.received:{source}:{sha256(raw_content)[0:16]}:0
 * Same raw content from the same source always produces the same key,
 * making repeated ingest of identical content idempotent (INV-SIG-001, DEC-00010).
 */
function ingestIdempotencyKey(source: SignalSource, rawContent: string): string {
  const contentHash = crypto.createHash('sha256').update(rawContent).digest('hex').slice(0, 16);
  return `signals:signal.received:${source}:${contentHash}:0`;
}

// -------------------------
// Text ingest
// -------------------------

export async function ingestText(text: string): Promise<IngestResult | StructuredError> {
  if (Buffer.byteLength(text, 'utf8') > TEXT_SIZE_LIMIT) {
    return structuredError('Content exceeds 1MB text size limit', 'CONTENT_TOO_LARGE');
  }

  const signalId = uuidv4();
  const idempotencyKey = ingestIdempotencyKey('text', text);

  return runPipeline({
    signalId,
    idempotencyKey,
    source: 'text',
    rawContent: text,
    normalized: normalize(text),
  });
}

// -------------------------
// File ingest
// -------------------------

export async function ingestFile(filePath: string): Promise<IngestResult | StructuredError> {
  if (!fs.existsSync(filePath)) {
    return structuredError(`File not found: ${filePath}`, 'FILE_NOT_FOUND');
  }

  const stat = fs.statSync(filePath);
  if (stat.size > FILE_SIZE_LIMIT) {
    return structuredError('File exceeds 10MB size limit', 'CONTENT_TOO_LARGE');
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return structuredError(`Failed to read file: ${msg}`, 'FILE_READ_ERROR');
  }

  const rawContent = `[file:${filePath}]\n\n${content}`;
  const signalId = uuidv4();
  const idempotencyKey = ingestIdempotencyKey('file', rawContent);

  return runPipeline({
    signalId,
    idempotencyKey,
    source: 'file',
    rawContent,
    normalized: normalize(content),
  });
}

// -------------------------
// Alert ingest
// -------------------------

export async function ingestAlert(
  severity: string,
  message: string,
): Promise<IngestResult | StructuredError> {
  const alertContent: AlertNormalizedContent = {
    severity,
    message,
    alert: true,
  };

  const raw = JSON.stringify(alertContent);
  const normalized = `[ALERT severity=${severity}] ${message}`;

  const signalId = uuidv4();
  const idempotencyKey = ingestIdempotencyKey('alert', raw);

  return runPipeline({
    signalId,
    idempotencyKey,
    source: 'alert',
    rawContent: raw,
    normalized,
  });
}

// -------------------------
// Webhook ingest (called from serve.ts)
// -------------------------

export async function ingestWebhook(
  body: Record<string, unknown>,
): Promise<IngestResult | StructuredError> {
  const raw = JSON.stringify(body);
  if (Buffer.byteLength(raw, 'utf8') > TEXT_SIZE_LIMIT) {
    return structuredError('Webhook payload exceeds 1MB size limit', 'CONTENT_TOO_LARGE');
  }

  const signalId = uuidv4();
  const idempotencyKey = ingestIdempotencyKey('webhook', raw);
  const normalized = normalize(
    typeof body.text === 'string'
      ? body.text
      : typeof body.message === 'string'
      ? body.message
      : raw,
  );

  return runPipeline({
    signalId,
    idempotencyKey,
    source: 'webhook',
    rawContent: raw,
    normalized,
  });
}

// -------------------------
// Core pipeline
// -------------------------

interface PipelineParams {
  signalId: string;
  idempotencyKey: string;
  source: SignalSource;
  rawContent: string;
  normalized: string;
}

async function runPipeline(params: PipelineParams): Promise<IngestResult | StructuredError> {
  const { signalId, idempotencyKey, source, rawContent, normalized } = params;

  // Stage 1: Store-first write
  const { signal, existed } = insertSignal({
    id: signalId,
    idempotency_key: idempotencyKey,
    source,
    raw_content: rawContent,
    normalized,
  });

  // Idempotency: return existing signal data
  if (existed) {
    return {
      signal_id: `sig-${signal.id}`,
      status: signal.status,
      route_target: 'pending',
    };
  }

  // Emit signal.received (fire-and-forget)
  emitSignalReceived(signal.id, source, signal.received_at);

  // Stage 2: LLM classification
  let classificationResult: Awaited<ReturnType<typeof classifySignal>>;
  try {
    classificationResult = await classifySignal(normalized || rawContent);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Signal stays in 'pending' status — store-first guarantee
    updateSignalStatus(signal.id, 'pending', `classification failed: ${msg}`);

    // Graceful degraded mode: no API key → warn and return stored signal without classification
    if (msg.includes('ANTHROPIC_API_KEY')) {
      process.stderr.write(
        'WARN: degraded mode active — auto-launch disabled (confidence capped at 0.80)\n',
      );
      return {
        signal_id: `sig-${signal.id}`,
        status: 'pending' as const,
        route_target: 'pending' as const,
      };
    }
    return structuredError(`Classification failed: ${msg}`, 'CLASSIFICATION_ERROR');
  }

  const { result, modelId, degraded } = classificationResult;
  const confidenceTier = getConfidenceTier(result.confidence);

  // Write classification record — capture return to get classification.id for event emission
  const classification = insertClassification({
    signal_id: signal.id,
    type: result.type,
    crew_type: result.crew_type,
    confidence_score: result.confidence,
    confidence_tier: confidenceTier,
    degraded,
    model_ids: [modelId],
  });

  // v0.1 reachable status transitions: pending → classified → routed (crew_idd, aggregate)
  //   or pending → classified → direct_outcome
  // v0.2 paths (not implemented): threshold_crossed (correlation window), expired (retry exhaustion)
  updateSignalStatus(signal.id, 'classified');
  setSignalClassifiedAt(signal.id);

  // Emit signal.classified (fire-and-forget)
  emitSignalClassified(signal.id, classification);

  // Stage 3: Route (LLM-free threshold comparison)
  const ingestResult = await routeSignal({
    signalId: signal.id,
    classification: result,
    degraded,
    normalizedContent: normalized || rawContent,
  });

  return ingestResult;
}

export function isStructuredError(val: unknown): val is StructuredError {
  return (
    typeof val === 'object' &&
    val !== null &&
    'error' in val &&
    'code' in val
  );
}
