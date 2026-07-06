/**
 * wicked-signals v0.1 — Routing decision logic
 *
 * Routing is ENTIRELY LLM-free: decision is based on threshold comparison only.
 *
 * Thresholds (v0.1 degraded mode):
 * - confidence >= 0.85 → auto_launch_crew   (unreachable in v0.1; cap is 0.80)
 * - confidence >= 0.60 → crew_idd
 * - type === 'direct'  → direct_outcome     (regardless of confidence tier)
 * - otherwise          → aggregate
 */

import { spawnSync } from 'child_process';
import {
  insertRoutingDecision,
  updateSignalStatus,
  setSignalRoutedAt,
  type InsertRoutingDecisionParams,
} from './db.js';
import {
  emitSignalRouted,
  emitActionLaunched,
} from './events.js';
import type {
  ClassificationResult,
  RoutingPath,
  DirectOutcomePayload,
  IngestResult,
} from './types.js';

const HIGH_CONFIDENCE_THRESHOLD = 0.85;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.60;

export interface RouteParams {
  signalId: string;
  classification: ClassificationResult;
  degraded: boolean;
  /** Signal's normalized text (or raw content fallback), truncated to 500 chars for crew launch */
  normalizedContent?: string;
}

export interface RouteResult {
  routing_path: RoutingPath;
  action_reference: string | null;
  direct_outcome_payload: DirectOutcomePayload | null;
  rationale: string;
}

/**
 * Determine routing path from classification — no LLM calls.
 * Returns the routing path, action reference, and direct outcome payload.
 */
export function determineRoutingPath(params: {
  type: string;
  confidence: number;
  degraded: boolean;
}): RoutingPath {
  const { type, confidence, degraded } = params;

  // Direct outcome takes precedence
  if (type === 'direct') {
    return 'direct_outcome';
  }

  // High confidence → auto launch crew (unreachable in v0.1 since cap is 0.80)
  if (!degraded && confidence >= HIGH_CONFIDENCE_THRESHOLD) {
    return 'auto_launch_crew';
  }

  // In degraded mode, high threshold is effectively unreachable (cap at 0.80)
  // but we still implement the check for correctness
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) {
    return 'auto_launch_crew';
  }

  // Medium confidence → crew_idd (human-in-the-loop)
  if (confidence >= MEDIUM_CONFIDENCE_THRESHOLD) {
    return 'crew_idd';
  }

  // Low confidence → aggregate
  return 'aggregate';
}

/**
 * Build the crew launch command string.
 * Used as action_reference for auto_launch_crew path.
 */
export function buildCrewLaunchCommand(params: {
  crewType: string;
  problem: string;
  signalId: string;
}): string {
  return `npx wicked-crew crew launch --type ${params.crewType} --problem "${params.problem.replace(/"/g, '\\"')}" --source signals:${params.signalId}`;
}

/**
 * Execute crew launch via child process (fire-and-forget in v0.1).
 * Returns the command string used as action_reference.
 */
function launchCrew(params: {
  crewType: string;
  problem: string;
  signalId: string;
}): string {
  const cmd = buildCrewLaunchCommand(params);

  try {
    spawnSync(
      'npx',
      [
        'wicked-crew',
        'crew',
        'launch',
        '--type', params.crewType,
        '--problem', params.problem,
        '--source', `signals:${params.signalId}`,
      ],
      {
        stdio: 'ignore',
        timeout: 10000,
        shell: false,
      },
    );
  } catch {
    // Fire-and-forget: crew launch failures are logged but don't fail routing
  }

  return cmd;
}

/**
 * Route a classified signal. Writes routing decision to DB, updates signal status,
 * emits bus events. Returns IngestResult.
 */
export async function routeSignal(params: RouteParams): Promise<IngestResult> {
  const { signalId, classification, degraded, normalizedContent } = params;
  const { type, crew_type, confidence, resolved_text, rationale } = classification;

  const routing_path = determineRoutingPath({ type, confidence, degraded });

  let action_reference: string | null = null;
  let direct_outcome_payload_obj: DirectOutcomePayload | null = null;
  let direct_outcome_payload_str: string | null = null;

  if (routing_path === 'direct_outcome') {
    direct_outcome_payload_obj = {
      resolved_text: resolved_text ?? '',
      confidence_score: confidence,
      resolved_at: new Date().toISOString(),
      source_models: [`claude-haiku-4-5-20251001`],
    };
    direct_outcome_payload_str = JSON.stringify(direct_outcome_payload_obj);
  }

  if (routing_path === 'auto_launch_crew' && crew_type) {
    // NOTE: In v0.1, this branch is unreachable because confidence is capped at 0.80 < 0.85
    // Included for spec compliance; the crew launch is fire-and-forget.
    // --problem passes the signal's normalized text (truncated to 500 chars), not the LLM rationale.
    const problem = (normalizedContent ?? rationale).slice(0, 500);
    action_reference = launchCrew({
      crewType: crew_type,
      problem,
      signalId,
    });
    emitActionLaunched(signalId, action_reference);
  }

  // Write routing decision to DB
  const decisionParams: InsertRoutingDecisionParams = {
    signal_id: signalId,
    routing_path,
    confidence_score: confidence,
    action_reference,
    direct_outcome_payload: direct_outcome_payload_str,
    rationale,
  };
  // Capture routing decision to get its id for event idempotency key
  const routingDecision = insertRoutingDecision(decisionParams);

  // v0.1 reachable routing statuses: direct_outcome, routed (crew_idd or auto_launch_crew), aggregate→routed
  // v0.2 paths (not implemented): threshold_crossed (correlation window), expired (retry exhaustion)
  const newStatus =
    routing_path === 'direct_outcome'
      ? 'direct_outcome'
      : routing_path === 'auto_launch_crew'
      ? 'routed'
      : 'routed';

  updateSignalStatus(signalId, newStatus, `routed via ${routing_path}`);
  setSignalRoutedAt(signalId);

  // Emit bus event (fire-and-forget)
  emitSignalRouted(signalId, routingDecision, confidence);

  const result: IngestResult = {
    signal_id: `sig-${signalId}`,
    status: newStatus,
    route_target: routing_path,
    confidence,
  };

  if (routing_path === 'direct_outcome' && direct_outcome_payload_obj) {
    result.resolved_text = direct_outcome_payload_obj.resolved_text;
  }

  return result;
}
