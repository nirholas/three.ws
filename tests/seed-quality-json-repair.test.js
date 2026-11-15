// On 2026-11-15, the first production tick of the catalog vision phase
// (SEED_VISION_PHASE=1) recorded its first real row as vision "unavailable":
//
//   Unexpected token 'T', ..."ritique": The render"... is not valid JSON
//
// The vision lane answered in JSON, with every score present, but left the
// free-text "critique" value unquoted. The one-shot retry re-asked with a
// "your reply was prose" hint, got the same shape back, and the gate published
// the asset on the mesh verdict alone. A local measurement over the 10 most
// recent seeds hit the same failure on 3 of them. A judge that scored the asset
// and only fumbled the comment is a verdict, not an outage.
//
// These tests drive the shared transport body through remoteTransport with a
// real fetchImpl seam, so the repair is the exact code inProcessTransport runs.

import { describe, it, expect } from 'vitest';
import { remoteTransport } from '../api/_lib/seed-quality.js';

function visionServer(replies) {
	const prompts = [];
	const fetchImpl = async (url, init) => {
		const body = JSON.parse(init.body);
		prompts.push(body.prompt);
		const text = replies[Math.min(prompts.length - 1, replies.length - 1)];
		return new Response(JSON.stringify({ text }), { status: 200, headers: { 'content-type': 'application/json' } });
	};
	return { fetchImpl, prompts };
}

const PNG = Buffer.from('png');

describe('judge replies with an unquoted free-text value', () => {
	it('reads the scores when the critique is left unquoted (the production reply shape)', async () => {
		const reply =
			'{"photorealism": 6, "geometryIntegrity": 7, "textureFidelity": 5, "promptAdherence": 8, "critique": The render shows a full figure in a shell jacket holding a handheld anemometer, with slightly soft fabric texture.}';
		const { fetchImpl, prompts } = visionServer([reply]);
		const t = remoteTransport({ origin: 'https://judge.test', fetchImpl });
		const out = await t.judgeRealism({ png: PNG, prompt: 'a meteorologist in a storm-proof shell jacket', viewLabel: 'front' });
		expect(out).toMatchObject({ photorealism: 6, geometryIntegrity: 7, textureFidelity: 5, promptAdherence: 8 });
		expect(out.critique).toMatch(/^The render shows a full figure/);
		expect(prompts).toHaveLength(1);
	});

	it('keeps inner quotes and commas inside the repaired value', async () => {
		const reply =
			'{"photorealism": 4, "geometryIntegrity": 3, "textureFidelity": 4, "promptAdherence": 6, "critique": The "chrome" rods are fused, and the shell reads as plastic}';
		const { fetchImpl } = visionServer([reply]);
		const t = remoteTransport({ origin: 'https://judge.test', fetchImpl });
		const out = await t.judgeRealism({ png: PNG, prompt: 'a snare drum', viewLabel: 'front' });
		expect(out).toMatchObject({ photorealism: 4, geometryIntegrity: 3, textureFidelity: 4, promptAdherence: 6 });
		expect(out.critique).toBe('The "chrome" rods are fused, and the shell reads as plastic');
	});

	it('repairs an unquoted note in the rig-readiness reply without touching the booleans', async () => {
		const reply =
			'{"subjectPresent": true, "singleSubject": true, "complete": false, "limbsSeparated": true, "blob": false, "note": The figure is cut off at the waist}';
		const { fetchImpl } = visionServer([reply]);
		const t = remoteTransport({ origin: 'https://judge.test', fetchImpl });
		const out = await t.judgeRigReadiness({ png: PNG, prompt: 'a dentist', category: 'avatar' });
		expect(out).toEqual({
			subjectPresent: true,
			singleSubject: true,
			complete: false,
			limbsSeparated: true,
			blob: false,
			note: 'The figure is cut off at the waist',
		});
	});

	it('never invents a score: an unquoted value where a number belongs still fails', async () => {
		const reply = '{"photorealism": six, "geometryIntegrity": 7, "textureFidelity": 5, "promptAdherence": 8, "critique": "ok"}';
		const { fetchImpl } = visionServer([reply]);
		const t = remoteTransport({ origin: 'https://judge.test', fetchImpl });
		await expect(t.judgeRealism({ png: PNG, prompt: 'a lamp', viewLabel: 'front' })).rejects.toThrow(/missing numeric photorealism/);
	});

	it('still fails a reply that is prose with no JSON at all, after the one format retry', async () => {
		const { fetchImpl, prompts } = visionServer(['The image shows a lamp on a table.']);
		const t = remoteTransport({ origin: 'https://judge.test', fetchImpl });
		await expect(t.judgeRealism({ png: PNG, prompt: 'a lamp', viewLabel: 'front' })).rejects.toThrow();
		expect(prompts).toHaveLength(2);
		expect(prompts[1]).toMatch(/Reply with ONLY the JSON object/);
	});
});
