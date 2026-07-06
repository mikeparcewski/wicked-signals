# Brainstorm Sample: wicked-signals Feature Ideas

Five ideas for enhancing wicked-signals beyond v0.1.

---

## Idea 1: CorrelationWindow Aggregation (v0.2)

Group related signals that arrive within a configurable time window (e.g., 30s) and route them together as a single crew brief. Useful for burst events from monitoring systems that fire multiple alerts about the same root cause.

**Benefit:** Reduces noise and prevents duplicate crew launches for the same incident.

---

## Idea 2: Learned Classifications via wicked-memory (v0.3)

Store high-confidence routing decisions as exemplars in wicked-memory. On future signals, retrieve similar exemplars and use them to bias the classification prompt — turning repeated patterns into zero-shot fast paths.

**Benefit:** Improves classification speed and consistency for common signal patterns over time.

---

## Idea 3: Multi-Model Classification Council (v0.2)

Run classification across 2–3 models (e.g., claude-haiku-4-5-20251001 + a local Ollama model) and use majority vote or weighted averaging to produce a higher-confidence score. Unlocks the 0.85+ threshold for auto-launch.

**Benefit:** Lifts confidence cap above 0.80 and enables the auto_launch_crew path in production.

---

## Idea 4: Signal Replay and Reprocessing (v0.3)

Allow `wicked-signals replay <signal_id>` to reprocess a signal through the classification and routing pipeline with the current model — useful after model upgrades or threshold tuning.

**Benefit:** Retroactively improves routing quality without reingesting source data.

---

## Idea 5: Postgres Backend (v0.3)

Support a Postgres connection string via `WICKED_SIGNALS_DB_URL` as an alternative to the default SQLite backend. Uses the same schema, but adds row-level locking for multi-instance deployments.

**Benefit:** Enables horizontal scaling and multi-writer scenarios for high-volume signal ingestion.
