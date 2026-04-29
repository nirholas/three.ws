import { describe, it, expect, vi } from 'vitest';
import { validateLaunchForm, handleLaunchSubmit } from '../public/studio/launch-panel.js';

const VALID = { name: 'My Token', symbol: 'MTK', description: 'A test token', initialBuy: '0.5', feeTier: 'standard' };

describe('validateLaunchForm — required fields', () => {
	it('fails when name is empty', () => {
		const { ok, errors } = validateLaunchForm({ ...VALID, name: '' });
		expect(ok).toBe(false);
		expect(errors.name).toBeTruthy();
	});

	it('fails when name is whitespace only', () => {
		const { ok, errors } = validateLaunchForm({ ...VALID, name: '   ' });
		expect(ok).toBe(false);
		expect(errors.name).toBeTruthy();
	});

	it('fails when symbol is empty', () => {
		const { ok, errors } = validateLaunchForm({ ...VALID, symbol: '' });
		expect(ok).toBe(false);
		expect(errors.symbol).toBeTruthy();
	});

	it('fails when description is empty', () => {
		const { ok, errors } = validateLaunchForm({ ...VALID, description: '' });
		expect(ok).toBe(false);
		expect(errors.description).toBeTruthy();
	});

	it('fails all three required fields at once', () => {
		const { ok, errors } = validateLaunchForm({ name: '', symbol: '', description: '' });
		expect(ok).toBe(false);
		expect(errors.name).toBeTruthy();
		expect(errors.symbol).toBeTruthy();
		expect(errors.description).toBeTruthy();
	});

	it('passes when all required fields are filled', () => {
		const { ok, errors } = validateLaunchForm(VALID);
		expect(ok).toBe(true);
		expect(Object.keys(errors)).toHaveLength(0);
	});
});

describe('validateLaunchForm — initialBuy', () => {
	it('rejects a negative initialBuy', () => {
		const { ok, errors } = validateLaunchForm({ ...VALID, initialBuy: '-1' });
		expect(ok).toBe(false);
		expect(errors.initialBuy).toBeTruthy();
	});

	it('accepts zero initialBuy', () => {
		const { ok } = validateLaunchForm({ ...VALID, initialBuy: '0' });
		expect(ok).toBe(true);
	});

	it('accepts a positive initialBuy', () => {
		const { ok } = validateLaunchForm({ ...VALID, initialBuy: '2.5' });
		expect(ok).toBe(true);
	});

	it('accepts an absent initialBuy (optional field)', () => {
		const { name, symbol, description, feeTier } = VALID;
		const { ok } = validateLaunchForm({ name, symbol, description, feeTier });
		expect(ok).toBe(true);
	});

	it('rejects a non-numeric initialBuy', () => {
		const { ok, errors } = validateLaunchForm({ ...VALID, initialBuy: 'abc' });
		expect(ok).toBe(false);
		expect(errors.initialBuy).toBeTruthy();
	});
});

describe('handleLaunchSubmit', () => {
	it('calls onSubmit with fields when valid', () => {
		const handler = vi.fn();
		const result = handleLaunchSubmit(VALID, handler);
		expect(result.ok).toBe(true);
		expect(handler).toHaveBeenCalledOnce();
		expect(handler).toHaveBeenCalledWith(VALID);
	});

	it('does not call onSubmit when name is missing', () => {
		const handler = vi.fn();
		handleLaunchSubmit({ ...VALID, name: '' }, handler);
		expect(handler).not.toHaveBeenCalled();
	});

	it('does not call onSubmit when symbol is missing', () => {
		const handler = vi.fn();
		handleLaunchSubmit({ ...VALID, symbol: '' }, handler);
		expect(handler).not.toHaveBeenCalled();
	});

	it('returns validation errors when form is invalid', () => {
		const result = handleLaunchSubmit({ name: '', symbol: 'X', description: 'desc' }, () => {});
		expect(result.ok).toBe(false);
		expect(result.errors.name).toBeTruthy();
	});
});
