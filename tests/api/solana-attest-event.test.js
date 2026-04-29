import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';

import {
	buildPayload,
	taskHash,
	verifyPumpkitSignature,
} from '../../api/agents/solana/_handlers.js';

const SECRET = 'test-secret';
const AGENT  = 'AgentAssetPubkey1111111111111111111111111111';
const TOKEN  = 'TokenMintPubkey22222222222222222222222222222';

function sign(timestamp, raw, secret = SECRET) {
	return crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex');
}

describe('taskHash', () => {
	it('is deterministic for the same inputs', () => {
		expect(taskHash('t1', TOKEN)).toBe(taskHash('t1', TOKEN));
	});
	it('differs across token mints', () => {
		expect(taskHash('t1', TOKEN)).not.toBe(taskHash('t1', TOKEN.replace('2', '3')));
	});
});

describe('buildPayload', () => {
	const base = { event_id: 'evt-1', agent_asset: AGENT, token_mint: TOKEN, task_id: 'task-1' };

	it('graduation -> validation passed=true with pumpkit.graduation source', () => {
		const p = buildPayload({ ...base, event_type: 'graduation' });
		expect(p.kind).toBe('threews.validation.v1');
		expect(p.passed).toBe(true);
		expect(p.source).toBe('pumpkit.graduation');
		expect(p.event_id).toBe('evt-1');
		expect(p.agent).toBe(AGENT);
	});

	it('cto_detected -> validation passed=false', () => {
		const p = buildPayload({ ...base, event_type: 'cto_detected' });
		expect(p.kind).toBe('threews.validation.v1');
		expect(p.passed).toBe(false);
		expect(p.source).toBe('pumpkit.cto');
	});

	it('fee_claim -> feedback score=5', () => {
		const p = buildPayload({ ...base, event_type: 'fee_claim', detail: { lamports: 1_000_000 } });
		expect(p.kind).toBe('threews.feedback.v1');
		expect(p.score).toBe(5);
		expect(p.source).toBe('pumpkit.fee_claim');
		expect(p.detail).toEqual({ lamports: 1_000_000 });
	});

	it('whale_trade -> task with scope_hash', () => {
		const p = buildPayload({ ...base, event_type: 'whale_trade' });
		expect(p.kind).toBe('threews.task.v1');
		expect(p.task_id).toBe('task-1');
		expect(p.scope_hash).toBe(taskHash('task-1', TOKEN));
	});
});

describe('verifyPumpkitSignature', () => {
	const raw = Buffer.from('{"event_id":"e","x":1}', 'utf8');
	const now = 1_700_000_000;

	it('accepts a fresh, correctly signed request', () => {
		const ts = now;
		const sig = sign(ts, raw);
		expect(verifyPumpkitSignature({ secret: SECRET, timestamp: ts, signature: sig, raw, nowSecs: now }))
			.toEqual({ ok: true, reason: 'ok' });
	});

	it('rejects a stale timestamp outside the replay window', () => {
		const ts = now - 10 * 60;
		const sig = sign(ts, raw);
		expect(verifyPumpkitSignature({ secret: SECRET, timestamp: ts, signature: sig, raw, nowSecs: now }))
			.toMatchObject({ ok: false, reason: 'stale' });
	});

	it('rejects a signature computed against a different body (replay binding)', () => {
		const ts = now;
		const sig = sign(ts, Buffer.from('{"event_id":"different"}', 'utf8'));
		expect(verifyPumpkitSignature({ secret: SECRET, timestamp: ts, signature: sig, raw, nowSecs: now }))
			.toMatchObject({ ok: false });
	});

	it('rejects the wrong secret', () => {
		const ts = now;
		const sig = sign(ts, raw, 'other-secret');
		expect(verifyPumpkitSignature({ secret: SECRET, timestamp: ts, signature: sig, raw, nowSecs: now }))
			.toMatchObject({ ok: false });
	});

	it('rejects when headers are missing', () => {
		expect(verifyPumpkitSignature({ secret: SECRET, timestamp: undefined, signature: undefined, raw, nowSecs: now }))
			.toMatchObject({ ok: false, reason: 'missing' });
	});

	it('rejects a non-numeric timestamp', () => {
		expect(verifyPumpkitSignature({ secret: SECRET, timestamp: 'not-a-number', signature: 'aa', raw, nowSecs: now }))
			.toMatchObject({ ok: false, reason: 'bad_timestamp' });
	});
});
