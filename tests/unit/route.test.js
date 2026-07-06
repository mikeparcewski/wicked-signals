"use strict";
/**
 * Unit tests: routing logic
 *
 * Verifies that determineRoutingPath is LLM-free and returns correct
 * routing paths based on confidence thresholds.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const route_1 = require("../../src/route");
describe('determineRoutingPath', () => {
    describe('direct type always routes to direct_outcome', () => {
        it('routes direct type with high confidence to direct_outcome', () => {
            const path = (0, route_1.determineRoutingPath)({ type: 'direct', confidence: 0.9, degraded: false });
            expect(path).toBe('direct_outcome');
        });
        it('routes direct type with low confidence to direct_outcome', () => {
            const path = (0, route_1.determineRoutingPath)({ type: 'direct', confidence: 0.1, degraded: false });
            expect(path).toBe('direct_outcome');
        });
        it('routes direct type in degraded mode to direct_outcome', () => {
            const path = (0, route_1.determineRoutingPath)({ type: 'direct', confidence: 0.75, degraded: true });
            expect(path).toBe('direct_outcome');
        });
    });
    describe('crew-launch type with confidence thresholds', () => {
        it('routes confidence >= 0.85 to auto_launch_crew (non-degraded)', () => {
            const path = (0, route_1.determineRoutingPath)({ type: 'crew-launch', confidence: 0.85, degraded: false });
            expect(path).toBe('auto_launch_crew');
        });
        it('routes confidence >= 0.85 to auto_launch_crew (degraded — unreachable in practice)', () => {
            // In v0.1 degraded mode, confidence is capped at 0.80, so this is unreachable
            // but the routing logic still handles it correctly
            const path = (0, route_1.determineRoutingPath)({ type: 'crew-launch', confidence: 0.85, degraded: true });
            expect(path).toBe('auto_launch_crew');
        });
        it('routes confidence 0.80 (v0.1 cap) to crew_idd in degraded mode', () => {
            const path = (0, route_1.determineRoutingPath)({ type: 'crew-launch', confidence: 0.80, degraded: true });
            expect(path).toBe('crew_idd');
        });
        it('routes confidence >= 0.60 to crew_idd', () => {
            const path = (0, route_1.determineRoutingPath)({ type: 'crew-launch', confidence: 0.70, degraded: false });
            expect(path).toBe('crew_idd');
        });
        it('routes confidence exactly 0.60 to crew_idd', () => {
            const path = (0, route_1.determineRoutingPath)({ type: 'crew-launch', confidence: 0.60, degraded: false });
            expect(path).toBe('crew_idd');
        });
        it('routes confidence < 0.60 to aggregate', () => {
            const path = (0, route_1.determineRoutingPath)({ type: 'crew-launch', confidence: 0.40, degraded: false });
            expect(path).toBe('aggregate');
        });
        it('routes confidence 0.0 to aggregate', () => {
            const path = (0, route_1.determineRoutingPath)({ type: 'crew-launch', confidence: 0.0, degraded: false });
            expect(path).toBe('aggregate');
        });
    });
    describe('garden-action type', () => {
        it('routes garden-action with high confidence to aggregate (not direct_outcome)', () => {
            const path = (0, route_1.determineRoutingPath)({ type: 'garden-action', confidence: 0.5, degraded: false });
            expect(path).toBe('aggregate');
        });
    });
    describe('v0.1 degraded mode invariant', () => {
        it('confidence capped at 0.80 cannot reach auto_launch_crew in degraded mode', () => {
            // This test documents the v0.1 design invariant:
            // In degraded mode, confidence cap is 0.80, which is below the 0.85 threshold
            // Therefore auto_launch_crew is never reached
            const maxDegradedConfidence = 0.80;
            const path = (0, route_1.determineRoutingPath)({
                type: 'crew-launch',
                confidence: maxDegradedConfidence,
                degraded: true,
            });
            expect(path).not.toBe('auto_launch_crew');
        });
    });
});
describe('buildCrewLaunchCommand', () => {
    it('builds a valid crew launch command string', () => {
        const cmd = (0, route_1.buildCrewLaunchCommand)({
            crewType: 'analysis',
            problem: 'Analyze the performance regression',
            signalId: 'abc-123',
        });
        expect(cmd).toContain('npx wicked-crew crew launch');
        expect(cmd).toContain('--type analysis');
        expect(cmd).toContain('--source signals:abc-123');
    });
    it('escapes double quotes in problem text', () => {
        const cmd = (0, route_1.buildCrewLaunchCommand)({
            crewType: 'feature',
            problem: 'Build a "dark mode" toggle',
            signalId: 'sig-456',
        });
        expect(cmd).toContain('\\"dark mode\\"');
    });
});
//# sourceMappingURL=route.test.js.map