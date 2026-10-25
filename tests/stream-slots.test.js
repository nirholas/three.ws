import { describe, it, expect } from 'vitest';
import { createStreamSlots } from '../api/_lib/stream-slots.js';

describe('createStreamSlots', () => {
	it('grants up to the cap per key and refuses the next', () => {
		const slots = createStreamSlots({ perKey: 2, total: 100 });
		const a = slots.acquire('1.1.1.1');
		const b = slots.acquire('1.1.1.1');
		expect(a).toBeTypeOf('function');
		expect(b).toBeTypeOf('function');
		expect(slots.acquire('1.1.1.1')).toBeNull();
		expect(slots.acquire('2.2.2.2')).toBeTypeOf('function');
	});

	it('frees a slot on release, and release is idempotent', () => {
		const slots = createStreamSlots({ perKey: 1, total: 100 });
		const release = slots.acquire('k');
		expect(slots.acquire('k')).toBeNull();
		release();
		release();
		expect(slots.acquire('k')).toBeTypeOf('function');
		expect(slots.acquire('k')).toBeNull();
	});

	it('enforces a process-wide ceiling across keys', () => {
		const slots = createStreamSlots({ perKey: 5, total: 2 });
		expect(slots.acquire('a')).toBeTypeOf('function');
		expect(slots.acquire('b')).toBeTypeOf('function');
		expect(slots.acquire('c')).toBeNull();
	});
});
