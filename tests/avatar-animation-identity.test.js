// Per-avatar animation identity: the shared resolver, the server-side schema
// and the baked clip allowlist.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
	resolveClip,
	normalizeAnimation,
	intensityTimeScale,
	clipsToPreload,
	PLATFORM_DEFAULTS,
	MAX_EMOTES,
} from '../src/avatar-animation-identity.js';
import { avatarAppearance } from '../api/_lib/validate.js';
import { validateAppearance } from '../api/_lib/accessories.js';
import { isValidClipId, listClipIds } from '../api/_lib/animation-clips.js';

const manifest = JSON.parse(readFileSync(new URL('../public/animations/manifest.json', import.meta.url), 'utf8'));

describe('resolveClip', () => {
	it('falls back to the platform defaults when nothing is saved', () => {
		for (const appearance of [undefined, null, {}, { animation: {} }]) {
			expect(resolveClip(appearance, 'idle')).toEqual({ clip: PLATFORM_DEFAULTS.idle, timeScale: 1, source: 'default' });
			expect(resolveClip(appearance, 'walk').clip).toBe(PLATFORM_DEFAULTS.walk);
			expect(resolveClip(appearance, 'gesture').clip).toBe(PLATFORM_DEFAULTS.gesture);
		}
	});

	it('honors a partial record and defaults the rest', () => {
		const appearance = { animation: { walk: 'av-walk-crouching' } };
		expect(resolveClip(appearance, 'walk')).toMatchObject({ clip: 'av-walk-crouching', source: 'avatar' });
		expect(resolveClip(appearance, 'idle')).toMatchObject({ clip: 'idle', source: 'default' });
	});

	it('ignores an invalid clip id instead of throwing', () => {
		const bad = { animation: { idle: 'Not A Clip!', walk: 42, emotes: ['../x', null, 'dance'] } };
		expect(resolveClip(bad, 'idle').clip).toBe('idle');
		expect(resolveClip(bad, 'walk').clip).toBe(PLATFORM_DEFAULTS.walk);
		expect(resolveClip(bad, 'emote:0').clip).toBe('dance');
	});

	it('ignores a clip the runtime cannot play (non-humanoid rig, missing clip)', () => {
		const appearance = { animation: { idle: 'av-chilling', walk: 'soldier-walk' } };
		const known = new Set(['idle', 'av-walk-feminine', 'av-chilling']);
		expect(resolveClip(appearance, 'idle', { known }).clip).toBe('av-chilling');
		expect(resolveClip(appearance, 'walk', { known })).toMatchObject({ clip: 'av-walk-feminine', source: 'default' });
		expect(resolveClip(appearance, 'walk', { known: (c) => c === 'soldier-walk' }).clip).toBe('soldier-walk');
	});

	it('maps emote:<n> to the loadout and falls back out of range', () => {
		const appearance = { animation: { emotes: ['dance', 'rumba'] } };
		expect(resolveClip(appearance, 'emote:0').clip).toBe('dance');
		expect(resolveClip(appearance, 'emote:1').clip).toBe('rumba');
		expect(resolveClip(appearance, 'emote:2')).toMatchObject({ clip: 'wave', source: 'default' });
		expect(resolveClip(appearance, 'gesture').clip).toBe('dance');
		expect(resolveClip(appearance, 'nonsense').clip).toBe('idle');
	});

	it('scales gesture speed with intensity inside hard bounds', () => {
		const at = (gestureIntensity) => resolveClip({ animation: { emotes: ['dance'], gestureIntensity } }, 'gesture').timeScale;
		expect(at(0)).toBeCloseTo(0.6);
		expect(at(0.5)).toBeCloseTo(1);
		expect(at(1)).toBeCloseTo(1.4);
		expect(at(7)).toBeCloseTo(1.4);
		expect(at(-3)).toBeCloseTo(0.6);
		expect(at(Number.NaN)).toBeCloseTo(1);
		expect(intensityTimeScale(undefined)).toBeCloseTo(1);
		expect(resolveClip({ animation: { walk: 'jog', gestureIntensity: 1 } }, 'walk').timeScale).toBe(1);
	});

	it('is deterministic', () => {
		const appearance = { animation: { idle: 'av-chilling', emotes: ['dance'], gestureIntensity: 0.3 } };
		expect(resolveClip(appearance, 'gesture')).toEqual(resolveClip(appearance, 'gesture'));
	});
});

describe('normalizeAnimation / clipsToPreload', () => {
	it('dedupes and caps the emote loadout', () => {
		const emotes = Array.from({ length: 20 }, (_, i) => `clip-${i % 12}`);
		const out = normalizeAnimation({ emotes });
		expect(out.emotes.length).toBe(MAX_EMOTES);
		expect(new Set(out.emotes).size).toBe(MAX_EMOTES);
	});

	it('returns an empty object for junk', () => {
		for (const junk of [null, 5, 'x', [], undefined]) expect(normalizeAnimation(junk)).toEqual({});
	});

	it('lists the defaults plus the saved idle and walk', () => {
		expect(clipsToPreload({})).toEqual(['idle', 'av-walk-feminine']);
		expect(clipsToPreload({ animation: { idle: 'av-chilling', walk: 'jog' } })).toEqual(['idle', 'av-walk-feminine', 'av-chilling', 'jog']);
	});
});

describe('server validation', () => {
	it('baked clip allowlist matches the animation manifest exactly', () => {
		expect(listClipIds()).toEqual(manifest.map((c) => c.name));
	});

	it('platform defaults are real manifest clips', () => {
		for (const id of Object.values(PLATFORM_DEFAULTS)) expect(isValidClipId(id)).toBe(true);
	});

	it('accepts a valid record and round-trips it through the schema', () => {
		const animation = { idle: 'av-chilling', walk: 'av-walk-crouching', gestureIntensity: 0.75, moodBlend: 0.2, emotes: ['dance', 'wave'] };
		const parsed = avatarAppearance.parse({ animation });
		expect(parsed.animation).toEqual(animation);
		expect(validateAppearance(parsed)).toBeNull();
	});

	it('rejects an unknown clip id (idle, walk, emotes)', () => {
		expect(validateAppearance({ animation: { idle: 'no-such-clip' } })).toMatch(/unknown animation clip/);
		// The PATCH route parses with this schema, so a failed parse is the 400.
		expect(avatarAppearance.safeParse({ animation: { idle: 'no-such-clip' } }).success).toBe(false);
		expect(validateAppearance({ animation: { walk: 'no-such-clip' } })).toMatch(/unknown animation clip/);
		expect(validateAppearance({ animation: { emotes: ['dance', 'no-such-clip'] } })).toMatch(/unknown animation clip/);
	});

	it('enforces the caps at the schema', () => {
		expect(avatarAppearance.safeParse({ animation: { gestureIntensity: 1.2 } }).success).toBe(false);
		expect(avatarAppearance.safeParse({ animation: { moodBlend: -0.1 } }).success).toBe(false);
		expect(avatarAppearance.safeParse({ animation: { emotes: Array(9).fill('dance') } }).success).toBe(false);
		expect(avatarAppearance.safeParse({ animation: { idle: 'Bad Id' } }).success).toBe(false);
		expect(avatarAppearance.safeParse({ animation: { extra: 1 } }).success).toBe(false);
	});
});
