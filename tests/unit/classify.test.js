"use strict";
/**
 * Unit tests: classification confidence capping
 *
 * Verifies v0.1 degraded mode invariants:
 * - Confidence is always capped at 0.80
 * - getConfidenceTier returns correct tier for score ranges
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
const classify_1 = require("../../src/classify");
beforeEach(() => {
    (0, classify_1.resetDegradedWarning)();
});
describe('getConfidenceTier', () => {
    it('returns high for score >= 0.85', () => {
        expect((0, classify_1.getConfidenceTier)(0.85)).toBe('high');
        expect((0, classify_1.getConfidenceTier)(0.90)).toBe('high');
        expect((0, classify_1.getConfidenceTier)(1.0)).toBe('high');
    });
    it('returns medium for score >= 0.60 and < 0.85', () => {
        expect((0, classify_1.getConfidenceTier)(0.60)).toBe('medium');
        expect((0, classify_1.getConfidenceTier)(0.70)).toBe('medium');
        expect((0, classify_1.getConfidenceTier)(0.84)).toBe('medium');
    });
    it('returns low for score < 0.60', () => {
        expect((0, classify_1.getConfidenceTier)(0.59)).toBe('low');
        expect((0, classify_1.getConfidenceTier)(0.5)).toBe('low');
        expect((0, classify_1.getConfidenceTier)(0.0)).toBe('low');
    });
    it('returns medium for the v0.1 confidence cap (0.80)', () => {
        // In v0.1, max confidence is 0.80, which is "medium" tier
        // This confirms auto-launch (high tier >= 0.85) is unreachable
        expect((0, classify_1.getConfidenceTier)(0.80)).toBe('medium');
    });
});
describe('v0.1 degraded mode invariants', () => {
    it('confidence cap 0.80 maps to medium tier — never high', () => {
        // This is the key v0.1 invariant: because confidence is capped at 0.80
        // and high tier requires >= 0.85, crew auto-launch is never triggered
        const cappedScore = 0.80;
        const tier = (0, classify_1.getConfidenceTier)(cappedScore);
        expect(tier).not.toBe('high');
        expect(tier).toBe('medium');
    });
    it('any score at or below the cap cannot trigger auto_launch_crew', () => {
        // All scores up to and including the cap fall below the high-confidence threshold
        for (const score of [0.0, 0.3, 0.5, 0.6, 0.7, 0.75, 0.79, 0.80]) {
            const tier = (0, classify_1.getConfidenceTier)(score);
            expect(tier).not.toBe('high');
        }
    });
});
describe('classifySignal - API key validation', () => {
    it('throws when ANTHROPIC_API_KEY is not set', async () => {
        const originalKey = process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        try {
            const { classifySignal } = await Promise.resolve().then(() => __importStar(require('../../src/classify')));
            await expect(classifySignal('test signal')).rejects.toThrow('ANTHROPIC_API_KEY');
        }
        finally {
            if (originalKey !== undefined) {
                process.env.ANTHROPIC_API_KEY = originalKey;
            }
        }
    });
});
//# sourceMappingURL=classify.test.js.map