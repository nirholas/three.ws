import { describe, expect, it } from 'vitest';
import {
	AuthenticationError, ConfirmationRequiredError, InsufficientFundsError, NotFoundError, PermissionError,
	RateLimitError, ServerError, ThreeAgentsError, ValidationError, SwapError,
} from '../src/index.ts';
import { errorFromResponse, fieldErrorsFrom } from '../src/errors.ts';

const mk = (status, code, details) => errorFromResponse('msg', { status, code, details, method: 'GET', path: '/x' });

describe('error mapping', () => {
	it.each([
		[400, 'invalid_parameter', ValidationError],
		[422, 'unprocessable', ValidationError],
		[401, 'unauthorized', AuthenticationError],
		[402, 'payment_required', InsufficientFundsError],
		[403, 'forbidden', PermissionError],
		[404, 'not_found', NotFoundError],
		[429, 'rate_limited', RateLimitError],
		[500, 'internal', ServerError],
		[503, 'unavailable', ServerError],
		[418, 'teapot', ThreeAgentsError],
	])('%i %s maps to the right class', (status, code, Cls) => {
		const err = mk(status, code);
		expect(err).toBeInstanceOf(Cls);
		expect(err.status).toBe(status);
		expect(err.code).toBe(code);
	});

	it('maps insufficient-funds codes regardless of status', () => {
		expect(mk(400, 'insufficient_credits')).toBeInstanceOf(InsufficientFundsError);
	});
	it('maps confirmation_required and swap_failed by code', () => {
		expect(mk(409, 'confirmation_required')).toBeInstanceOf(ConfirmationRequiredError);
		expect(mk(422, 'swap_failed', { inputMint: 'A', outputMint: 'B' })).toBeInstanceOf(SwapError);
	});
	it('extracts the missing scope from a 403', () => {
		expect(mk(403, 'insufficient_scope', { required: 'wallet:read' }).scope).toBe('wallet:read');
		expect(errorFromResponse('needs "agents:write"', { status: 403, code: 'x' }).scope).toBe('agents:write');
	});
	it('normalises validation details', () => {
		expect(fieldErrorsFrom({ parameter: 'limit' }, 'bad')).toEqual([{ field: 'limit', message: 'bad' }]);
		expect(fieldErrorsFrom({ fieldErrors: { name: ['too short'] } })).toEqual([{ field: 'name', message: 'too short' }]);
		expect(fieldErrorsFrom([{ path: ['a', 'b'], message: 'm' }])).toEqual([{ field: 'a.b', message: 'm' }]);
		expect(fieldErrorsFrom(null)).toEqual([]);
	});
});
