// Unit tests for the finalizer's job-id discriminator: the base64url JSON
// envelope the GCP worker lanes store in forge_creations.replicate_job_id
// (see api/_providers/gcp.js) vs. opaque third-party ids the cron cannot poll.
// Importing the cron module is safe: db/neon clients are created lazily.

import { describe, it, expect } from 'vitest';
import { decodeWorkerEnvelope, decideFailedSweep, decideNvidiaStall } from '../api/cron/forge-finalize.js';

function pack(obj) {
	return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

describe('decodeWorkerEnvelope', () => {
	it('decodes a real GCP worker envelope', () => {
		const envelope = pack({
			mode: 'trellis',
			taskId: '8e033fff-6ba2-4324-a388-e093a30ed083',
			baseUrl: 'https://model-trellis.example.test',
			resultKey: 'result_gcs_url',
		});
		const decoded = decodeWorkerEnvelope(envelope);
		expect(decoded).not.toBeNull();
		expect(decoded.taskId).toBe('8e033fff-6ba2-4324-a388-e093a30ed083');
		expect(decoded.baseUrl).toBe('https://model-trellis.example.test');
	});

	it('rejects an envelope missing taskId or baseUrl', () => {
		expect(decodeWorkerEnvelope(pack({ taskId: 'only-task' }))).toBeNull();
		expect(decodeWorkerEnvelope(pack({ baseUrl: 'https://x.test' }))).toBeNull();
		expect(decodeWorkerEnvelope(pack({}))).toBeNull();
	});

	it('rejects opaque third-party ids (Replicate predictions, HF jobs)', () => {
		expect(decodeWorkerEnvelope('rr2p7dbwd5rmyk4b3xyz')).toBeNull();
		expect(decodeWorkerEnvelope('hf-space-job-42')).toBeNull();
		expect(decodeWorkerEnvelope('')).toBeNull();
		expect(decodeWorkerEnvelope(null)).toBeNull();
	});

	it('rejects base64url payloads that are not JSON objects', () => {
		expect(decodeWorkerEnvelope(Buffer.from('"a string"').toString('base64url'))).toBeNull();
		expect(decodeWorkerEnvelope(Buffer.from('42').toString('base64url'))).toBeNull();
	});
});

// The unattended-failover decision. Evidence for why this exists: in a 7-day
// production window, 8 of the trellis_selfhost failures were the literal
// "task orphaned: no progress within 30 minutes (runner instance likely
// restarted mid-job)". The worker only declares that orphan at 30 minutes, long
// after the browser's 12-minute poll budget has expired, so the attended
// failover in api/forge.js pollJob never saw them. The cron did see them, and
// dead-ended every one. These jobs still had their prompt and reference image
// on the row: fully recoverable work thrown away.
describe('decideFailedSweep', () => {
	it('defers while an attended client may still act, so no duplicate GPU work', () => {
		expect(decideFailedSweep({ ageMinutes: 3, hasReferenceImage: true })).toBe('defer');
		expect(decideFailedSweep({ ageMinutes: 12.9, hasReferenceImage: true })).toBe('defer');
	});

	it('redispatches an orphaned job once the attended window has passed', () => {
		// The 30-minute worker orphan: exactly the class that used to die here.
		expect(decideFailedSweep({ ageMinutes: 31, hasReferenceImage: true })).toBe('redispatch');
		expect(decideFailedSweep({ ageMinutes: 13, hasReferenceImage: true })).toBe('redispatch');
	});

	it('has nothing to resubmit without a stored reference view', () => {
		expect(decideFailedSweep({ ageMinutes: 31, hasReferenceImage: false })).toBe('terminal');
	});

	it('leaves sketch jobs on their purpose-built lane', () => {
		expect(decideFailedSweep({ ageMinutes: 31, hasReferenceImage: true, path: 'sketch' })).toBe('terminal');
	});

	it('bounds the chain at the same hop cap as the attended failover', () => {
		expect(decideFailedSweep({ ageMinutes: 31, hasReferenceImage: true, hop: 2 })).toBe('redispatch');
		expect(decideFailedSweep({ ageMinutes: 31, hasReferenceImage: true, hop: 3 })).toBe('terminal');
		expect(decideFailedSweep({ ageMinutes: 31, hasReferenceImage: true, hop: 99 })).toBe('terminal');
	});

	it('treats an unknowable age as past the attended window rather than deferring forever', () => {
		expect(decideFailedSweep({ ageMinutes: undefined, hasReferenceImage: true })).toBe('redispatch');
	});
});

// The free NVIDIA NIM text lane has no alternate lane to fail a stuck prompt
// over to (forge-failover.js excludes it: text-only, no stored reference image
// to reconstruct from), so a stalled poll gets exactly one resubmit attempt
// before the hard TTL reaps it, instead of silently burning the full 45 minutes
// on a request that will never resolve on its own.
describe('decideNvidiaStall', () => {
	it('defers while an attended client may still be polling', () => {
		expect(decideNvidiaStall({ ageMinutes: 3 })).toBe('defer');
		expect(decideNvidiaStall({ ageMinutes: 12.9 })).toBe('defer');
	});

	it('resubmits once the attended window has passed and the hard TTL has not hit', () => {
		expect(decideNvidiaStall({ ageMinutes: 13 })).toBe('resubmit');
		expect(decideNvidiaStall({ ageMinutes: 30 })).toBe('resubmit');
	});

	it('never resubmits a job twice', () => {
		expect(decideNvidiaStall({ ageMinutes: 30, alreadyResubmitted: true })).toBe('defer');
	});

	it('goes terminal at or past the hard TTL regardless of the resubmit flag', () => {
		expect(decideNvidiaStall({ ageMinutes: 45 })).toBe('terminal');
		expect(decideNvidiaStall({ ageMinutes: 50, alreadyResubmitted: true })).toBe('terminal');
		expect(decideNvidiaStall({ ageMinutes: 45, alreadyResubmitted: false })).toBe('terminal');
	});

	it('treats an unknowable age as inside the attended window rather than resubmitting blind', () => {
		expect(decideNvidiaStall({ ageMinutes: undefined })).toBe('defer');
	});
});
