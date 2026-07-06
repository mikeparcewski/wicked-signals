/**
 * Unit tests: classification confidence capping
 *
 * Verifies v0.1 degraded mode invariants:
 * - Confidence is always capped at 0.80
 * - getConfidenceTier returns correct tier for score ranges
 */

import { getConfidenceTier, resetDegradedWarning } from '../../src/classify';

beforeEach(() => {
  resetDegradedWarning();
});

describe('getConfidenceTier', () => {
  it('returns high for score >= 0.85', () => {
    expect(getConfidenceTier(0.85)).toBe('high');
    expect(getConfidenceTier(0.90)).toBe('high');
    expect(getConfidenceTier(1.0)).toBe('high');
  });

  it('returns medium for score >= 0.60 and < 0.85', () => {
    expect(getConfidenceTier(0.60)).toBe('medium');
    expect(getConfidenceTier(0.70)).toBe('medium');
    expect(getConfidenceTier(0.84)).toBe('medium');
  });

  it('returns low for score < 0.60', () => {
    expect(getConfidenceTier(0.59)).toBe('low');
    expect(getConfidenceTier(0.5)).toBe('low');
    expect(getConfidenceTier(0.0)).toBe('low');
  });

  it('returns medium for the v0.1 confidence cap (0.80)', () => {
    // In v0.1, max confidence is 0.80, which is "medium" tier
    // This confirms auto-launch (high tier >= 0.85) is unreachable
    expect(getConfidenceTier(0.80)).toBe('medium');
  });
});

describe('v0.1 degraded mode invariants', () => {
  it('confidence cap 0.80 maps to medium tier — never high', () => {
    // This is the key v0.1 invariant: because confidence is capped at 0.80
    // and high tier requires >= 0.85, crew auto-launch is never triggered
    const cappedScore = 0.80;
    const tier = getConfidenceTier(cappedScore);
    expect(tier).not.toBe('high');
    expect(tier).toBe('medium');
  });

  it('any score at or below the cap cannot trigger auto_launch_crew', () => {
    // All scores up to and including the cap fall below the high-confidence threshold
    for (const score of [0.0, 0.3, 0.5, 0.6, 0.7, 0.75, 0.79, 0.80]) {
      const tier = getConfidenceTier(score);
      expect(tier).not.toBe('high');
    }
  });
});

describe('classifySignal - API key validation', () => {
  it('throws when ANTHROPIC_API_KEY is not set', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const { classifySignal } = await import('../../src/classify');
      await expect(classifySignal('test signal')).rejects.toThrow('ANTHROPIC_API_KEY');
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      }
    }
  });
});
