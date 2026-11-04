// inProcessTransport is what the catalog vision cron judges with. It used to
// call Vertex Gemini directly for both judge questions, with no other provider
// behind it, so on 2026-11-01, when Vertex started answering 403 (project
// billing), every in-process verdict came back unavailable while the remote and
// local-judge transports, which go through api/_lib/vision.js's provider chain,
// kept judging. The cron would have spent its retries on every row and then
// published each one ungated.
//
// These tests hold the transport to the same chain and the same prompts and
// parsing as the measured transports, with the render staying in this process.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = { describe: [], render: [] };

vi.mock('../api/_lib/vision.js', () => ({
	describeImage: vi.fn(async (opts) => {
		calls.describe.push(opts);
		if (/rendered view of a 3D asset generated for a public asset catalog/.test(opts.prompt)) {
			return {
				text: '{"subjectPresent": true, "singleSubject": true, "complete": true, "limbsSeparated": true, "blob": false, "note": "whole figure"}',
				provider: 'fallback-lane',
			};
		}
		return {
			text: '{"photorealism": 7, "geometryIntegrity": 8, "textureFidelity": 6, "promptAdherence": 9, "critique": "clean"}',
			provider: 'fallback-lane',
		};
	}),
}));

vi.mock('../api/_lib/render-clip.js', () => ({
	renderClip: vi.fn(async (opts) => {
		calls.render.push(opts);
		return { png: Buffer.from('png-bytes') };
	}),
}));

// Vertex is configured but refusing, exactly the production state on 2026-11-01.
vi.mock('../api/_lib/vertex-gemini.js', () => ({
	vertexGeminiAvailable: () => true,
	vertexGeminiChatUrl: () => 'https://vertex.invalid/chat',
	vertexGeminiHeaders: async () => {
		throw new Error('vertex-gemini 403: There are issues with your billing account');
	},
}));

const { inProcessTransport } = await import('../api/_lib/seed-quality.js');

beforeEach(() => {
	calls.describe.length = 0;
	calls.render.length = 0;
});

describe('inProcessTransport', () => {
	it('judges realism through the vision provider chain, not Vertex alone', async () => {
		const t = inProcessTransport();
		const out = await t.judgeRealism({ png: Buffer.from('png'), prompt: 'a red toolbox', viewLabel: 'front' });
		expect(out).toMatchObject({ photorealism: 7, geometryIntegrity: 8, textureFidelity: 6, promptAdherence: 9 });
		expect(calls.describe).toHaveLength(1);
		expect(calls.describe[0].imageBase64).toBe(Buffer.from('png').toString('base64'));
		// The rung measured to answer in bare JSON is asked first.
		expect(calls.describe[0].lead).toEqual(['cloudflare']);
		expect(calls.describe[0].mimeType).toBe('image/png');
	});

	it('judges rig readiness through the same chain', async () => {
		const t = inProcessTransport();
		const out = await t.judgeRigReadiness({ png: Buffer.from('png'), prompt: 'a dentist', category: 'avatar' });
		expect(out).toMatchObject({ subjectPresent: true, singleSubject: true, complete: true, limbsSeparated: true, blob: false });
	});

	it('renders in this process with the catalog camera and background', async () => {
		const t = inProcessTransport();
		const png = await t.render({ glbUrl: 'https://cdn.example/a.glb', theta: 0, phi: 78 });
		expect(png.equals(Buffer.from('png-bytes'))).toBe(true);
		expect(calls.render).toHaveLength(1);
		expect(calls.render[0]).toMatchObject({ glbUrl: 'https://cdn.example/a.glb', width: 768, height: 768, cameraOrbit: { theta: 0, phi: 78 } });
		expect(calls.render[0].background).toBeTruthy();
	});

	it('is named in-process so a recorded verdict says where it was judged', () => {
		expect(inProcessTransport().name).toBe('in-process');
	});
});
