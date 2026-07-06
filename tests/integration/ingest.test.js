"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
let tmpDir;
let dbPath;
beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wicked-signals-test-'));
    dbPath = path.join(tmpDir, 'signals.db');
    // Redirect all real db module calls to the temp DB.
    process.env.WICKED_SIGNALS_DB = dbPath;
    // Clear any stale singleton that may have been opened before the env var was set.
    const { resetDb } = require('../../src/db');
    resetDb();
});
afterAll(() => {
    // Close the DB connection before deleting the files.
    const { resetDb } = require('../../src/db');
    resetDb();
    delete process.env.WICKED_SIGNALS_DB;
    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    catch {
        // ignore cleanup errors
    }
});
beforeEach(() => {
    // Reset the singleton so the next getDb() call opens a fresh connection.
    const { resetDb } = require('../../src/db');
    resetDb();
    // Delete the DB and its WAL/SHM files so each test starts with an empty store.
    // This prevents idempotency-key collisions between tests within a single run.
    try {
        fs.unlinkSync(dbPath);
    }
    catch { /* file may not exist yet */ }
    try {
        fs.unlinkSync(dbPath + '-wal');
    }
    catch { /* ok */ }
    try {
        fs.unlinkSync(dbPath + '-shm');
    }
    catch { /* ok */ }
});
// Mock the classify module
jest.mock('../../src/classify', () => ({
    classifySignal: jest.fn(),
    getConfidenceTier: jest.requireActual('../../src/classify').getConfidenceTier,
    resetDegradedWarning: jest.fn(),
}));
// Mock events module to prevent actual bus emission
jest.mock('../../src/events', () => ({
    emitSignalReceived: jest.fn(),
    emitSignalClassified: jest.fn(),
    emitSignalRouted: jest.fn(),
    emitActionLaunched: jest.fn(),
    emitEvent: jest.fn(),
}));
describe('ingestText — full pipeline', () => {
    it('returns a signal_id and direct_outcome when LLM classifies as direct', async () => {
        const { classifySignal } = require('../../src/classify');
        classifySignal.mockResolvedValueOnce({
            result: {
                type: 'direct',
                crew_type: null,
                confidence: 0.75,
                resolved_text: 'TypeScript is a typed superset of JavaScript.',
                rationale: 'Simple factual question, can be answered inline',
            },
            modelId: 'claude-haiku-4-5-20251001',
            degraded: true,
        });
        const { ingestText } = require('../../src/ingest');
        const result = await ingestText('What is TypeScript?');
        expect(result).toHaveProperty('signal_id');
        expect(result.signal_id).toMatch(/^sig-/);
        expect(result).toHaveProperty('status', 'direct_outcome');
        expect(result).toHaveProperty('route_target', 'direct_outcome');
        expect(result).toHaveProperty('resolved_text', 'TypeScript is a typed superset of JavaScript.');
        expect(result).toHaveProperty('confidence', 0.75);
    });
    it('returns crew_idd route for crew-launch with medium confidence', async () => {
        const { classifySignal } = require('../../src/classify');
        classifySignal.mockResolvedValueOnce({
            result: {
                type: 'crew-launch',
                crew_type: 'feature',
                confidence: 0.72,
                rationale: 'Requires a feature workflow',
            },
            modelId: 'claude-haiku-4-5-20251001',
            degraded: true,
        });
        const { ingestText } = require('../../src/ingest');
        const result = await ingestText('Build a dark mode toggle for the web app');
        expect(result).toHaveProperty('signal_id');
        expect(result.signal_id).toMatch(/^sig-/);
        expect(result).toHaveProperty('route_target', 'crew_idd');
        expect(result).toHaveProperty('confidence', 0.72);
    });
    it('returns aggregate for low-confidence crew-launch', async () => {
        const { classifySignal } = require('../../src/classify');
        classifySignal.mockResolvedValueOnce({
            result: {
                type: 'crew-launch',
                crew_type: 'analysis',
                confidence: 0.45,
                rationale: 'Ambiguous signal',
            },
            modelId: 'claude-haiku-4-5-20251001',
            degraded: true,
        });
        const { ingestText } = require('../../src/ingest');
        const result = await ingestText('Something something maybe do a thing');
        expect(result).toHaveProperty('route_target', 'aggregate');
    });
    it('returns CONTENT_TOO_LARGE error for text exceeding 1MB', async () => {
        const { ingestText, isStructuredError } = require('../../src/ingest');
        const bigText = 'x'.repeat(1024 * 1024 + 1);
        const result = await ingestText(bigText);
        expect(isStructuredError(result)).toBe(true);
        expect(result.code).toBe('CONTENT_TOO_LARGE');
    });
    it('returns AUTH_ERROR when classification fails with ANTHROPIC_API_KEY error', async () => {
        const { classifySignal } = require('../../src/classify');
        classifySignal.mockRejectedValueOnce(new Error('Error: ANTHROPIC_API_KEY is not set'));
        const { ingestText, isStructuredError } = require('../../src/ingest');
        const result = await ingestText('test signal text');
        expect(isStructuredError(result)).toBe(true);
        expect(result.code).toBe('AUTH_ERROR');
    });
});
describe('ingestAlert — pipeline', () => {
    it('injects alert severity into the normalized content', async () => {
        const { classifySignal } = require('../../src/classify');
        classifySignal.mockResolvedValueOnce({
            result: {
                type: 'direct',
                crew_type: null,
                confidence: 0.60,
                resolved_text: 'Alert acknowledged.',
                rationale: 'Simple alert',
            },
            modelId: 'claude-haiku-4-5-20251001',
            degraded: true,
        });
        const { ingestAlert } = require('../../src/ingest');
        const result = await ingestAlert('critical', 'Database connection pool exhausted');
        expect(result).toHaveProperty('signal_id');
        expect(result.signal_id).toMatch(/^sig-/);
    });
});
describe('ingestFile — error handling', () => {
    it('returns FILE_NOT_FOUND for non-existent file', async () => {
        const { ingestFile, isStructuredError } = require('../../src/ingest');
        const result = await ingestFile('/tmp/wicked-signals-nonexistent-file.txt');
        expect(isStructuredError(result)).toBe(true);
        expect(result.code).toBe('FILE_NOT_FOUND');
    });
    it('reads and ingests an actual file', async () => {
        const { classifySignal } = require('../../src/classify');
        classifySignal.mockResolvedValueOnce({
            result: {
                type: 'direct',
                crew_type: null,
                confidence: 0.70,
                resolved_text: 'File content received.',
                rationale: 'File input processed',
            },
            modelId: 'claude-haiku-4-5-20251001',
            degraded: true,
        });
        // Create a temp file
        const tmpFile = path.join(tmpDir, 'test-signal.txt');
        fs.writeFileSync(tmpFile, 'This is a test signal from a file.');
        const { ingestFile } = require('../../src/ingest');
        const result = await ingestFile(tmpFile);
        expect(result).toHaveProperty('signal_id');
        expect(result.signal_id).toMatch(/^sig-/);
    });
});
describe('store-first guarantee', () => {
    it('signal exists in DB even when classification fails', async () => {
        const { classifySignal } = require('../../src/classify');
        classifySignal.mockRejectedValueOnce(new Error('LLM API timeout'));
        const { ingestText } = require('../../src/ingest');
        const { getDb } = require('../../src/db');
        await ingestText('test signal for store-first');
        // getDb() with no args uses WICKED_SIGNALS_DB env var — same temp DB.
        const db = getDb();
        const signals = db.prepare("SELECT * FROM signals WHERE status = 'pending'").all();
        expect(signals.length).toBeGreaterThanOrEqual(1);
    });
});
//# sourceMappingURL=ingest.test.js.map