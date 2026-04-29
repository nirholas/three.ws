import { describe, it, expect } from 'vitest';

import { detectEvents } from '../../api/cron/pumpfun-monitor.js';
import { deriveEventId } from '../../api/_lib/attest-event.js';

const baseRow = {
	mint_id:           'mint-uuid',
	token_mint:        'TokenMintPubkey22222222222222222222222222222',
	network:           'devnet',
	agent_id:          'agent-uuid',
	agent_authority:   'AuthorityKey1111111111111111111111111111111',
	graduated:         false,
	last_signature:    'sig1',
	last_signature_at: '2026-04-29T10:00:00Z',
	agent_row_id:      'agent-uuid',
	user_id:           'user-uuid',
	agent_asset:       'AgentAssetPubkey1111111111111111111111111111',
	last_graduated:    null,
	last_authority:    null,
	last_trade_signature: null,
};

describe('detectEvents', () => {
	it('emits nothing on first sight (no cursor) when nothing has flipped', () => {
		expect(detectEvents({ ...baseRow })).toEqual([]);
	});

	it('emits a graduation event on false -> true flip', () => {
		const events = detectEvents({ ...baseRow, graduated: true, last_graduated: false });
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			event_type: 'graduation',
			source:     'pumpfun.graduation',
			task_id:    `pumpfun:${baseRow.token_mint}:graduation`,
		});
		expect(events[0].event_id).toMatch(/^[0-9a-f]{32}$/);
	});

	it('does not re-emit graduation when already graduated', () => {
		const events = detectEvents({ ...baseRow, graduated: true, last_graduated: true });
		expect(events).toEqual([]);
	});

	it('emits a CTO event when authority changes', () => {
		const events = detectEvents({
			...baseRow,
			agent_authority: 'NewAuthority999999999999999999999999999999',
			last_authority:  baseRow.agent_authority,
		});
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			event_type: 'cto_detected',
			source:     'pumpfun.cto',
		});
		expect(events[0].detail.from).toBe(baseRow.agent_authority);
		expect(events[0].detail.to).toBe('NewAuthority999999999999999999999999999999');
	});

	it('does not emit CTO when authority is unchanged', () => {
		const events = detectEvents({ ...baseRow, last_authority: baseRow.agent_authority });
		expect(events).toEqual([]);
	});

	it('emits both graduation and CTO when both flip in the same tick', () => {
		const events = detectEvents({
			...baseRow,
			graduated: true, last_graduated: false,
			agent_authority: 'NewAuthority999999999999999999999999999999',
			last_authority:  baseRow.agent_authority,
		});
		expect(events.map((e) => e.event_type).sort()).toEqual(['cto_detected', 'graduation']);
	});

	it('produces stable event ids (idempotent across runs)', () => {
		const a = detectEvents({ ...baseRow, graduated: true, last_graduated: false })[0];
		const b = detectEvents({ ...baseRow, graduated: true, last_graduated: false })[0];
		expect(a.event_id).toBe(b.event_id);
	});
});

describe('deriveEventId', () => {
	it('hashes (event_type, mint, slot_or_ts) to 32 hex chars', () => {
		const id = deriveEventId({ event_type: 'graduation', mint: 'M', slot_or_ts: 'final' });
		expect(id).toMatch(/^[0-9a-f]{32}$/);
	});

	it('differs across event types', () => {
		const a = deriveEventId({ event_type: 'graduation', mint: 'M', slot_or_ts: 'x' });
		const b = deriveEventId({ event_type: 'cto',         mint: 'M', slot_or_ts: 'x' });
		expect(a).not.toBe(b);
	});
});
