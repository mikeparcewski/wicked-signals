/**
 * wicked-signals v0.1 — wicked-bus event emission
 *
 * Fire-and-forget: bus failures must never fail ingest.
 * Uses `npx wicked-bus emit` CLI — sync child_process.spawnSync.
 *
 * Idempotency key format (DEC-00010):
 *   signal.received:  signals:signal.received:{signal_id}:{sha256(signal_id)[0:16]}:0
 *   signal.classified: signals:signal.classified:{signal_id}:{classification_id[0:16]}:0
 *   signal.routed:    signals:signal.routed:{signal_id}:{routing_decision_id[0:16]}:0
 *   action.launched:  signals:action.launched:{signal_id}:{sha256(action_reference)[0:16]}:0
 */

import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import type { SignalClassification, RoutingDecision } from './types.js';

export interface EmitParams {
  type: string;
  domain: string;
  subdomain: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

/**
 * Emit an event via wicked-bus CLI.
 * Fire-and-forget: catches and suppresses all errors.
 */
export function emitEvent(params: EmitParams): void {
  try {
    const payloadStr = JSON.stringify(params.payload);

    spawnSync(
      'npx',
      [
        'wicked-bus',
        'emit',
        '--type', params.type,
        '--domain', params.domain,
        '--subdomain', params.subdomain,
        '--payload', payloadStr,
        '--idempotency-key', params.idempotencyKey,
      ],
      {
        stdio: 'ignore',
        timeout: 5000,
        shell: false,
      },
    );
  } catch {
    // Fire-and-forget: bus failures are silent
  }
}

// -------------------------
// Named event emitters
// -------------------------

export function emitSignalReceived(signalId: string, source: string, receivedAt: string): void {
  const hash = createHash('sha256').update(signalId).digest('hex').slice(0, 16);
  const idempotencyKey = `signals:signal.received:${signalId}:${hash}:0`;

  emitEvent({
    type: 'wicked.signals.signal.received',
    domain: 'wicked-signals',
    subdomain: 'signals.ingestion',
    payload: { signal_id: signalId, source, received_at: receivedAt },
    idempotencyKey,
  });
}

/**
 * Emit signal.classified event.
 * Payload includes all spec-required fields: classification_id, type, crew_type,
 * confidence_score, confidence_tier, degraded, replay.
 */
export function emitSignalClassified(
  signalId: string,
  classification: SignalClassification,
): void {
  const idempotencyKey = `signals:signal.classified:${signalId}:${classification.id.slice(0, 16)}:0`;

  emitEvent({
    type: 'wicked.signals.signal.classified',
    domain: 'wicked-signals',
    subdomain: 'signals.classification',
    payload: {
      signal_id: signalId,
      classification_id: classification.id,
      type: classification.type,
      crew_type: classification.crew_type,
      confidence_score: classification.confidence_score,
      confidence_tier: classification.confidence_tier,
      degraded: Boolean(classification.degraded),
      replay: false,
    },
    idempotencyKey,
  });
}

/**
 * Emit signal.routed event.
 * Payload uses field name `route_target` (not `routing_path`) per REQ-003 Event Catalog #3.
 */
export function emitSignalRouted(
  signalId: string,
  routingDecision: RoutingDecision,
  confidenceScore: number,
): void {
  const idempotencyKey = `signals:signal.routed:${signalId}:${routingDecision.id.slice(0, 16)}:0`;

  emitEvent({
    type: 'wicked.signals.signal.routed',
    domain: 'wicked-signals',
    subdomain: 'signals.routing',
    payload: {
      signal_id: signalId,
      route_target: routingDecision.routing_path,
      confidence_score: confidenceScore,
      routing_decision_id: routingDecision.id,
      routed_at: routingDecision.routed_at,
    },
    idempotencyKey,
  });
}

export function emitActionLaunched(signalId: string, actionReference: string): void {
  const hash = createHash('sha256').update(actionReference).digest('hex').slice(0, 16);
  const idempotencyKey = `signals:action.launched:${signalId}:${hash}:0`;

  emitEvent({
    type: 'wicked.signals.action.launched',
    domain: 'wicked-signals',
    subdomain: 'signals.routing',
    payload: {
      signal_id: signalId,
      action_reference: actionReference,
      launched_at: new Date().toISOString(),
    },
    idempotencyKey,
  });
}
