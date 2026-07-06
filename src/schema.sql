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
