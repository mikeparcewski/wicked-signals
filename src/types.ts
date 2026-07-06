/**
 * wicked-signals v0.1 — TypeScript interfaces
 */

export type SignalSource = 'text' | 'file' | 'alert' | 'webhook' | 'wicked-bus';

export type SignalStatus =
  | 'pending'
  | 'classified'
  | 'threshold_crossed'
  | 'routed'
  | 'expired'
  | 'direct_outcome';

export type ClassificationType = 'crew-launch' | 'direct' | 'garden-action';

export type CrewType = 'feature' | 'spike' | 'analysis' | 'knowledge' | 'ops' | 'brainstorm';

export type ConfidenceTier = 'high' | 'medium' | 'low';

export type RoutingPath =
  | 'auto_launch_crew'
  | 'crew_idd'
  | 'aggregate'
  | 'direct_outcome';

export interface Signal {
  id: string;
  idempotency_key: string;
  source: SignalSource;
  raw_content: string;
  normalized: string | null;
  status: SignalStatus;
  status_reason: string | null;
  received_at: string;
  classified_at: string | null;
  routed_at: string | null;
}

export interface SignalClassification {
  id: string;
  signal_id: string;
  type: ClassificationType;
  crew_type: CrewType | null;
  confidence_score: number;
  confidence_tier: ConfidenceTier;
  degraded: number; // 0 | 1 (SQLite boolean)
  model_ids: string | null; // JSON array string
  created_at: string;
}

export interface DirectOutcomePayload {
  resolved_text: string;
  confidence_score: number;
  resolved_at: string;
  source_models: string[];
}

export interface RoutingDecision {
  id: string;
  signal_id: string;
  routing_path: RoutingPath;
  confidence_score: number;
  action_reference: string | null;
  direct_outcome_payload: string | null; // JSON string of DirectOutcomePayload
  rationale: string | null;
  created_at: string;
  routed_at: string;
}

export interface OutboxEntry {
  id?: number;
  signal_id: string;
  event_type: string;
  payload: string; // JSON
  publish_status: 'pending' | 'published' | 'failed';
  attempts: number;
  last_attempt_at: string | null;
  created_at: string;
}

// --- Ingest inputs ---

export interface IngestTextOptions {
  text: string;
}

export interface IngestFileOptions {
  file: string;
}

export interface IngestAlertOptions {
  severity: string;
  message: string;
}

export interface AlertNormalizedContent {
  severity: string;
  message: string;
  alert: true;
}

// --- Classification result from LLM ---

export interface ClassificationResult {
  type: ClassificationType;
  crew_type: CrewType | null;
  confidence: number;
  resolved_text?: string;
  rationale: string;
}

// --- Ingest pipeline output ---

export interface IngestResult {
  signal_id: string;
  status: SignalStatus;
  route_target: RoutingPath | 'pending';
  confidence?: number;
  resolved_text?: string;
}

// --- CLI error output ---

export interface CliError {
  error: string;
  code: string;
}
