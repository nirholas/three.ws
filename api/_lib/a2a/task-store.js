// A2A task store: the server-side record behind GetTask (tasks/get on 0.3).
//
// A task is created by a send and read back by id, often by a different Cloud
// Run instance than the one that created it, so records live in Upstash Redis.
// Without Redis (local dev, tests) a per-process Map with the same TTL stands in;
// production always has Redis because the x402 idempotency cache refuses to boot
// without it.
//
// Task ids are random UUIDs minted by the server, never client-chosen for a new
// task, so knowing an id is the capability to read that task. A record holds:
//   task      the internal (0.3-shaped) Task, as last served
//   skillId   the skill that owns it, so follow-up messages route back to it
//   state     skill-private continuation data (a forge job handle, a prompt)

import { env } from '../env.js';
import { getRedis } from '../redis.js';

const KEY_PREFIX = 'a2a:task:';
const memory = new Map();

export function taskTtlSeconds() {
	const n = Number.parseInt(env.A2A_TASK_TTL_SECONDS, 10);
	return Number.isFinite(n) && n > 0 ? n : 86_400;
}

function key(route, id) {
	return `${KEY_PREFIX}${route}:${id}`;
}

function memoryGet(k) {
	const slot = memory.get(k);
	if (!slot) return null;
	if (slot.expiresAt < Date.now()) {
		memory.delete(k);
		return null;
	}
	return slot.record;
}

/** Read a task record, or null when it does not exist or has expired. */
export async function loadTask(route, id) {
	if (typeof id !== 'string' || !id) return null;
	const k = key(route, id);
	const redis = getRedis();
	if (!redis) return memoryGet(k);
	try {
		const raw = await redis.get(k);
		if (!raw) return memoryGet(k);
		return typeof raw === 'string' ? JSON.parse(raw) : raw;
	} catch (err) {
		// A Redis blip must not lose a task this instance just wrote.
		console.error('[a2a-task-store] get failed:', err?.message || err);
		return memoryGet(k);
	}
}

/** Write a task record. Never throws: the caller already has the task to return. */
export async function saveTask(route, record) {
	const id = record?.task?.id;
	if (!id) return;
	const k = key(route, id);
	const ttl = taskTtlSeconds();
	// The memory copy also serves as this instance's read-your-writes fallback
	// when Redis is configured but momentarily failing.
	memory.set(k, { record, expiresAt: Date.now() + ttl * 1000 });
	const redis = getRedis();
	if (!redis) return;
	try {
		await redis.set(k, JSON.stringify(record), { ex: ttl });
	} catch (err) {
		console.error('[a2a-task-store] set failed:', err?.message || err);
	}
}
