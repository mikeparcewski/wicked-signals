/**
 * Integration tests: full ingest pipeline
 *
 * Tests the pipeline end-to-end with a real SQLite DB (in-memory temp file).
 * Classification is mocked to avoid Anthropic API calls in CI.
 *
 * DB isolation strategy:
 *   - WICKED_SIGNALS_DB env var is set in beforeAll() to a unique temp path.
 *   - The actual getDb() reads this env var, so every call site in the real
 *     module (insertSignal, insertClassification, etc.) writes to the temp DB,
 *     not to the project's .wicked/signals.db.
 *   - resetDb() + file deletion in beforeEach() gives each test a clean slate.
 *   - afterAll() tears down the connection, unsets the env var, and removes the
 *     temp dir.  Both npm test runs produce the same result because the env var
 *     points to a fresh, per-run path.
 */
export {};
//# sourceMappingURL=ingest.test.d.ts.map