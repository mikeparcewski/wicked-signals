/**
 * wicked-signals v0.1 — SQLite database layer
 *
 * Auto-creates .wicked/signals.db in the current working directory.
 * Zero-config: applies schema inline on first run.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type {
  Signal,
  SignalClassification,
  RoutingDecision,
  OutboxEntry,
  SignalSource,
  SignalStatus,
  ClassificationType,
  CrewType,
  ConfidenceTier,
  RoutingPath,
} from './types.js';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL,
  source TEXT NOT NULL,
  raw_content TEXT NOT NULL,
  normalized TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  status_reason TEXT,
  received_at TEXT NOT NULL,
  classified_at TEXT,
  routed_at TEXT
);

CREATE TABLE IF NOT EXISTS signal_classifications (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL REFERENCES signals(id),
  type TEXT NOT NULL,
  crew_type TEXT,
  confidence_score REAL NOT NULL,
  confidence_tier TEXT NOT NULL,
  degraded INTEGER NOT NULL DEFAULT 0,
  model_ids TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS routing_decisions (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL REFERENCES signals(id),
  routing_path TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  action_reference TEXT,
  direct_outcome_payload TEXT,
  rationale TEXT,
  created_at TEXT NOT NULL,
  routed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  publish_status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  created_at TEXT NOT NULL
);
`;

let _db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (_db) return _db;

  const resolvedPath =
    dbPath ?? process.env.WICKED_SIGNALS_DB ?? path.join(process.cwd(), '.wicked', 'signals.db');
  const dir = path.dirname(resolvedPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _db = new Database(resolvedPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  // Apply schema
  _db.exec(SCHEMA_SQL);

  return _db;
}

/** Reset the cached DB instance (for testing) */
export function resetDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// -------------------------
// Idempotency key helpers
// -------------------------

/**
 * Build an idempotency key per DEC-00010:
 *   {domain}:{event_type}:{signal_id}:{sha256(signal_id)[0:16]}:{ordinal}
 */
export function buildIdempotencyKey(
  domain: string,
  eventType: string,
  signalId: string,
  ordinal = 0,
): string {
  const context = crypto.createHash('sha256').update(signalId).digest('hex').slice(0, 16);
  return `${domain}:${eventType}:${signalId}:${context}:${ordinal}`;
}

// -------------------------
// Signal operations
// -------------------------

export interface InsertSignalParams {
  id: string;
  idempotency_key: string;
  source: SignalSource;
  raw_content: string;
  normalized?: string | null;
}

/** Insert a new signal. Returns the inserted signal or the existing one on idempotency conflict. */
export function insertSignal(params: InsertSignalParams): { signal: Signal; existed: boolean } {
  const db = getDb();
  const now = new Date().toISOString();

  try {
    db.prepare(
      `INSERT INTO signals (id, idempotency_key, source, raw_content, normalized, status, received_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(
      params.id,
      params.idempotency_key,
      params.source,
      params.raw_content,
      params.normalized ?? null,
      now,
    );

    const signal = getSignalById(params.id);
    if (!signal) throw new Error('Signal not found after insert');
    return { signal, existed: false };
  } catch (err: unknown) {
    // SQLite UNIQUE constraint violation → idempotency hit
    if (
      err instanceof Error &&
      err.message.includes('UNIQUE constraint failed: signals.idempotency_key')
    ) {
      const existing = db
        .prepare('SELECT * FROM signals WHERE idempotency_key = ?')
        .get(params.idempotency_key) as Signal | undefined;
      if (!existing) throw err;
      return { signal: existing, existed: true };
    }
    throw err;
  }
}

export function getSignalById(id: string): Signal | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM signals WHERE id = ?').get(id) as Signal | undefined) ?? null;
}

export function updateSignalStatus(
  id: string,
  status: SignalStatus,
  statusReason?: string | null,
): void {
  const db = getDb();
  db.prepare(
    `UPDATE signals SET status = ?, status_reason = ? WHERE id = ?`,
  ).run(status, statusReason ?? null, id);
}

export function setSignalClassifiedAt(id: string): void {
  const db = getDb();
  db.prepare(`UPDATE signals SET classified_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    id,
  );
}

export function setSignalRoutedAt(id: string): void {
  const db = getDb();
  db.prepare(`UPDATE signals SET routed_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
}

export function listSignals(limit = 50): Signal[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM signals ORDER BY received_at DESC LIMIT ?')
    .all(limit) as Signal[];
}

// -------------------------
// Classification operations
// -------------------------

export interface InsertClassificationParams {
  signal_id: string;
  type: ClassificationType;
  crew_type: CrewType | null;
  confidence_score: number;
  confidence_tier: ConfidenceTier;
  degraded: boolean;
  model_ids: string[];
}

export function insertClassification(params: InsertClassificationParams): SignalClassification {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO signal_classifications
       (id, signal_id, type, crew_type, confidence_score, confidence_tier, degraded, model_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.signal_id,
    params.type,
    params.crew_type ?? null,
    params.confidence_score,
    params.confidence_tier,
    params.degraded ? 1 : 0,
    JSON.stringify(params.model_ids),
    now,
  );

  return db
    .prepare('SELECT * FROM signal_classifications WHERE id = ?')
    .get(id) as SignalClassification;
}

export function getLatestClassification(signalId: string): SignalClassification | null {
  const db = getDb();
  return (
    (db
      .prepare(
        'SELECT * FROM signal_classifications WHERE signal_id = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(signalId) as SignalClassification | undefined) ?? null
  );
}

// -------------------------
// Routing decision operations
// -------------------------

export interface InsertRoutingDecisionParams {
  signal_id: string;
  routing_path: RoutingPath;
  confidence_score: number;
  action_reference?: string | null;
  direct_outcome_payload?: string | null;
  rationale?: string | null;
}

export function insertRoutingDecision(
  params: InsertRoutingDecisionParams,
): RoutingDecision {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO routing_decisions
       (id, signal_id, routing_path, confidence_score, action_reference, direct_outcome_payload, rationale, created_at, routed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.signal_id,
    params.routing_path,
    params.confidence_score,
    params.action_reference ?? null,
    params.direct_outcome_payload ?? null,
    params.rationale ?? null,
    now,
    now,
  );

  return db.prepare('SELECT * FROM routing_decisions WHERE id = ?').get(id) as RoutingDecision;
}

export function getLatestRoutingDecision(signalId: string): RoutingDecision | null {
  const db = getDb();
  return (
    (db
      .prepare(
        'SELECT * FROM routing_decisions WHERE signal_id = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(signalId) as RoutingDecision | undefined) ?? null
  );
}

// -------------------------
// Outbox operations
// -------------------------

export function insertOutboxEntry(
  params: Omit<OutboxEntry, 'id' | 'publish_status' | 'attempts' | 'last_attempt_at' | 'created_at'>,
): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO outbox (signal_id, event_type, payload, publish_status, attempts, created_at)
     VALUES (?, ?, ?, 'pending', 0, ?)`,
  ).run(params.signal_id, params.event_type, params.payload, now);
}
