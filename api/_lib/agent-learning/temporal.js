// Temporal validity for agent memory: a fact is true over [valid_from, valid_to).
// Pure helpers shared by the store (memory.js) and its tests; no database here.

import { LearningError } from './errors.js';

/** Parse an ISO date or epoch-ms into a Date, or throw a 400 naming the field. */
export function parseInstant(value, field) {
	if (value === null || value === undefined || value === '') return null;
	const d = value instanceof Date ? value : new Date(typeof value === 'number' ? value : String(value));
	if (Number.isNaN(d.getTime())) {
		throw new LearningError(400, 'validation_error', `${field} must be an ISO 8601 date or time`);
	}
	return d;
}

const ms = (v) => (v == null ? null : new Date(v).getTime());

/** True when the row's interval contains `atMs`. valid_to is exclusive. */
export function isValidAt(row, atMs) {
	const from = ms(row.valid_from ?? row.created_at);
	const to = ms(row.valid_to);
	if (from != null && from > atMs) return false;
	return to == null || to > atMs;
}

/** True when the fact has not been superseded or closed as of `nowMs`. */
export function isCurrent(row, nowMs = Date.now()) {
	return isValidAt(row, nowMs);
}

/**
 * When a superseded fact stops being true: the new fact's valid_from, but never
 * before the old fact began (an interval cannot end before it starts).
 */
export function closingInstant(prior, newValidFrom) {
	const start = ms(prior.valid_from ?? prior.created_at) ?? 0;
	return new Date(Math.max(start, newValidFrom.getTime()));
}

/**
 * Order search hits so the current version of a fact outranks its history while
 * keeping each group's own order. Used when history is requested explicitly.
 */
export function currentFirst(rows, nowMs = Date.now()) {
	const now = [];
	const past = [];
	for (const r of rows) (isCurrent(r, nowMs) ? now : past).push(r);
	return [...now, ...past];
}
