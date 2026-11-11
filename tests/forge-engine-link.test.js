import { describe, it, expect } from 'vitest';
import { engineFromQuery } from '../src/forge-engine-link.js';

describe('engineFromQuery', () => {
	it('reads a lane id from ?engine=', () => {
		expect(engineFromQuery('?mode=image&engine=trellis2')).toBe('trellis2');
		expect(engineFromQuery('engine=trellis_selfhost')).toBe('trellis_selfhost');
	});

	it('normalizes case and whitespace', () => {
		expect(engineFromQuery('?engine=%20TRELLIS2%20')).toBe('trellis2');
	});

	it('ignores a missing or malformed id', () => {
		expect(engineFromQuery('')).toBeNull();
		expect(engineFromQuery('?tier=high')).toBeNull();
		expect(engineFromQuery('?engine=')).toBeNull();
		expect(engineFromQuery('?engine=a%22%3E%3Cscript%3E')).toBeNull();
		expect(engineFromQuery(`?engine=${'x'.repeat(41)}`)).toBeNull();
	});
});
