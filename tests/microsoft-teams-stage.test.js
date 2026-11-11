import { describe, expect, it } from 'vitest';
import {
	PIN_TEXT_MAX,
	cleanPinText,
	colorFor,
	createPin,
	initialsFor,
	isPin,
	modelKey,
	modelPageUrl,
	modelSourceUrl,
	normalizeAnim,
	normalizeModelState,
	packPose,
	parseModelInput,
	pinsForModel,
	pinsToMarkdown,
	playbackTime,
	poseDistance,
} from '../src/microsoft-teams-stage/stage-model.js';

const AVATAR = '13f259c7-7024-4d68-b1f0-dbbf52c06209';

describe('parseModelInput', () => {
	it('accepts a bare avatar id', () => {
		expect(parseModelInput(AVATAR.toUpperCase())).toEqual({ ref: { kind: 'avatar', id: AVATAR } });
	});
	it('reads the avatar id out of a three.ws link', () => {
		expect(parseModelInput(`https://three.ws/avatars/${AVATAR}`).ref).toEqual({ kind: 'avatar', id: AVATAR });
		expect(parseModelInput(`https://www.three.ws/studio?avatar=${AVATAR}`).ref).toEqual({ kind: 'avatar', id: AVATAR });
	});
	it('keeps a direct three.ws GLB link as a URL', () => {
		expect(parseModelInput(`https://three.ws/api/avatars/${AVATAR}/model.glb`).ref.kind).toBe('url');
	});
	it('accepts https model files and rejects everything else with a reason', () => {
		expect(parseModelInput('https://cdn.example.org/chair.glb?v=2').ref).toEqual({ kind: 'url', url: 'https://cdn.example.org/chair.glb?v=2' });
		expect(parseModelInput('https://cdn.example.org/scene.gltf').ref.kind).toBe('url');
		expect(parseModelInput('http://cdn.example.org/chair.glb').error).toMatch(/https/);
		expect(parseModelInput('https://example.org/page').error).toMatch(/\.glb/);
		expect(parseModelInput('not a link').error).toMatch(/not a link/);
		expect(parseModelInput('   ').error).toMatch(/Paste/);
	});
});

describe('model references', () => {
	it('resolves the GLB each participant loads', () => {
		expect(modelSourceUrl({ kind: 'avatar', id: AVATAR })).toBe(`https://three.ws/api/avatars/${AVATAR}/glb`);
		expect(modelSourceUrl({ kind: 'avatar', id: AVATAR }, { origin: 'http://localhost:3103' })).toBe(`http://localhost:3103/api/avatars/${AVATAR}/glb`);
		expect(modelSourceUrl({ kind: 'url', url: 'https://x.org/a.glb' })).toBe('https://x.org/a.glb');
		expect(modelSourceUrl({ kind: 'avatar', id: 'nope' })).toBeNull();
		expect(modelSourceUrl(null)).toBeNull();
	});
	it('links the export to the public viewer', () => {
		expect(modelPageUrl({ kind: 'avatar', id: AVATAR })).toBe(`https://three.ws/viewer#model=${encodeURIComponent(`https://three.ws/api/avatars/${AVATAR}/glb`)}`);
	});
	it('validates shared model state', () => {
		expect(normalizeModelState({ ref: { kind: 'avatar', id: AVATAR.toUpperCase() }, name: ' Michelle ' })).toEqual({ ref: { kind: 'avatar', id: AVATAR }, name: 'Michelle' });
		expect(normalizeModelState({ ref: { kind: 'url', url: 'javascript:alert(1)' } })).toBeNull();
		expect(normalizeModelState(undefined)).toBeNull();
	});
});

describe('participants', () => {
	it('gives the same person the same colour everywhere', () => {
		expect(colorFor('user-a')).toBe(colorFor('user-a'));
		expect(colorFor('user-a')).toMatch(/^#[0-9a-f]{6}$/);
	});
	it('derives initials', () => {
		expect(initialsFor('Ada Lovelace')).toBe('AL');
		expect(initialsFor('grace')).toBe('G');
		expect(initialsFor('')).toBe('?');
	});
});

describe('pins', () => {
	const ref = { kind: 'avatar', id: AVATAR };
	const base = { id: 'p1', position: [0.123456, 1, -2], normal: [0, 1, 0], authorId: 'u1', authorName: 'Ada', modelRef: ref, createdAt: 1000 };

	it('builds a clean pin scoped to the model', () => {
		const { pin } = createPin({ ...base, text: '  Thicken   this edge\u0007 ' });
		expect(pin).toMatchObject({ id: 'p1', model: modelKey(ref), p: [0.1235, 1, -2], text: 'Thicken this edge', authorName: 'Ada', color: colorFor('u1') });
		expect(isPin(pin)).toBe(true);
	});
	it('rejects an empty comment or a missing hit point', () => {
		expect(createPin({ ...base, text: '   ' }).error).toMatch(/comment/);
		expect(createPin({ ...base, text: 'x', position: [NaN, 0, 0] }).error).toMatch(/Click/);
	});
	it('caps comment length', () => {
		expect(cleanPinText('a'.repeat(1000))).toHaveLength(PIN_TEXT_MAX);
	});
	it('filters and orders pins per model', () => {
		const a = createPin({ ...base, id: 'a', text: 'second', createdAt: 2000 }).pin;
		const b = createPin({ ...base, id: 'b', text: 'first', createdAt: 1000 }).pin;
		const other = createPin({ ...base, id: 'c', text: 'other', modelRef: { kind: 'url', url: 'https://x.org/a.glb' } }).pin;
		expect(pinsForModel([a, other, b, { junk: true }], ref).map((p) => p.id)).toEqual(['b', 'a']);
	});
	it('exports markdown grouped by model with escaped text', () => {
		const a = createPin({ ...base, id: 'a', text: 'Round the *corner*', createdAt: Date.UTC(2026, 10, 11, 15, 4) }).pin;
		const b = createPin({ ...base, id: 'b', authorId: 'u2', authorName: 'Grace', text: 'Logo too small', createdAt: Date.UTC(2026, 10, 11, 15, 9) }).pin;
		const md = pinsToMarkdown([b, a], {
			models: [{ ref, name: 'Michelle' }],
			participants: ['Ada', 'Grace', 'Ada'],
			date: new Date(Date.UTC(2026, 10, 11, 15, 30)),
			timeZone: 'UTC',
		});
		expect(md).toContain('# three.ws design review');
		expect(md).toContain('Participants: Ada, Grace');
		expect(md).toContain(`## [Michelle](https://three.ws/viewer#model=`);
		expect(md).toMatch(/1\. Round the \\\*corner\\\* \(Ada, 3:04\sPM, at 0\.123, 1\.000, -2\.000\)/);
		expect(md).toMatch(/2\. Logo too small \(Grace, 3:09\sPM/);
	});
	it('says so when nobody placed a pin', () => {
		expect(pinsToMarkdown([], { timeZone: 'UTC' })).toContain('No comment pins were placed.');
	});
});

describe('camera poses', () => {
	it('packs and compares poses', () => {
		const a = packPose({ x: 1.23456, y: 2, z: 3 }, { x: 0, y: 1, z: 0 });
		expect(a).toEqual({ p: [1.235, 2, 3], t: [0, 1, 0] });
		expect(poseDistance(a, { p: [1.235, 2.5, 3], t: [0, 1, 0] })).toBeCloseTo(0.5);
		expect(poseDistance(a, null)).toBe(Infinity);
	});
});

describe('animation sync', () => {
	it('advances a playing clip by the time since the change', () => {
		expect(playbackTime({ playing: true, time: 1, rate: 1 }, 10_000, 12_500, 10)).toBeCloseTo(3.5);
	});
	it('wraps looping clips and clamps one-shots', () => {
		expect(playbackTime({ playing: true, time: 9, rate: 1 }, 0, 3000, 10)).toBeCloseTo(2);
		expect(playbackTime({ playing: true, time: 9, rate: 1 }, 0, 3000, 10, { loop: false })).toBe(10);
	});
	it('holds a paused clip and respects the rate', () => {
		expect(playbackTime({ playing: false, time: 4 }, 0, 99_000, 10)).toBe(4);
		expect(playbackTime({ playing: true, time: 0, rate: 2 }, 0, 1000, 10)).toBeCloseTo(2);
	});
	it('validates shared animation state', () => {
		expect(normalizeAnim({ clip: 2, playing: true, time: 1.5, rate: 1, model: 'avatar:x' })).toEqual({ clip: 2, playing: true, time: 1.5, rate: 1, model: 'avatar:x' });
		expect(normalizeAnim({ clip: -4, rate: 99 })).toEqual({ clip: -1, playing: false, time: 0, rate: 1, model: '' });
	});
});
