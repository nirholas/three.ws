// Consent state logic for the analytics cookie banner (src/shared/cookie-consent.js).
// PostHog may only run after an explicit "accept", and browser opt-out signals
// (Global Privacy Control, Do Not Track) count as a reject until the visitor
// chooses otherwise.
import { describe, it, expect, vi } from 'vitest';
import {
	CONSENT_KEY,
	readConsent,
	writeConsent,
	optOutSignal,
	resolveConsent,
	createConsentStore,
	applyToPosthog,
} from '../src/shared/cookie-consent.js';

function memoryStorage(seed = {}) {
	const m = new Map(Object.entries(seed));
	return {
		getItem: (k) => (m.has(k) ? m.get(k) : null),
		setItem: (k, v) => void m.set(k, String(v)),
		removeItem: (k) => void m.delete(k),
		key: (i) => [...m.keys()][i] ?? null,
		get length() {
			return m.size;
		},
	};
}

describe('stored choice', () => {
	it('returns null when nothing is stored or the value is corrupt', () => {
		expect(readConsent(memoryStorage())).toBeNull();
		expect(readConsent(memoryStorage({ [CONSENT_KEY]: '{nope' }))).toBeNull();
		expect(readConsent(memoryStorage({ [CONSENT_KEY]: '{"analytics":"maybe"}' }))).toBeNull();
	});

	it('round-trips granted and denied', () => {
		const s = memoryStorage();
		writeConsent(s, 'granted');
		expect(readConsent(s).analytics).toBe('granted');
		writeConsent(s, 'denied');
		expect(readConsent(s).analytics).toBe('denied');
	});

	it('survives storage that throws', () => {
		const broken = {
			getItem() {
				throw new Error('blocked');
			},
			setItem() {
				throw new Error('blocked');
			},
		};
		expect(readConsent(broken)).toBeNull();
		expect(() => writeConsent(broken, 'granted')).not.toThrow();
	});
});

describe('browser opt-out signals', () => {
	it('detects Global Privacy Control and Do Not Track', () => {
		expect(optOutSignal({ globalPrivacyControl: true })).toBe('gpc');
		expect(optOutSignal({ doNotTrack: '1' })).toBe('dnt');
		expect(optOutSignal({ doNotTrack: 'yes' })).toBe('dnt');
		expect(optOutSignal({ doNotTrack: '0' })).toBeNull();
		expect(optOutSignal({})).toBeNull();
	});

	it('resolves to denied without asking when a signal is set and no choice is stored', () => {
		const r = resolveConsent(memoryStorage(), { globalPrivacyControl: true });
		expect(r).toEqual({ status: 'denied', source: 'gpc' });
	});

	it('lets an explicit stored choice override a signal', () => {
		const s = memoryStorage();
		writeConsent(s, 'granted');
		expect(resolveConsent(s, { globalPrivacyControl: true })).toEqual({ status: 'granted', source: 'user' });
	});

	it('is unset with no choice and no signal', () => {
		expect(resolveConsent(memoryStorage(), {})).toEqual({ status: 'unset', source: null });
	});
});

describe('store', () => {
	it('persists a choice, reports it, and notifies listeners only on change', () => {
		const s = memoryStorage();
		const store = createConsentStore({ storage: s, navigator: {} });
		const seen = vi.fn();
		store.subscribe(seen);
		expect(store.get().status).toBe('unset');
		store.set('granted');
		store.set('granted');
		store.set('denied');
		expect(seen.mock.calls.map((c) => c[0].status)).toEqual(['granted', 'denied']);
		expect(readConsent(s).analytics).toBe('denied');
	});

	it('rejects values other than granted or denied', () => {
		const store = createConsentStore({ storage: memoryStorage(), navigator: {} });
		expect(() => store.set('yes')).toThrow();
	});
});

describe('applyToPosthog', () => {
	it('starts analytics only on granted', () => {
		const start = vi.fn();
		const win = { __threewsStartAnalytics: start, posthog: {} };
		applyToPosthog('unset', win, memoryStorage(), null);
		applyToPosthog('denied', win, memoryStorage(), null);
		expect(start).not.toHaveBeenCalled();
		applyToPosthog('granted', win, memoryStorage(), null);
		expect(start).toHaveBeenCalledTimes(1);
	});

	it('on denied: opts out, stops replay, and wipes ph_ storage and cookies', () => {
		const ph = { __loaded: true, opt_out_capturing: vi.fn(), stopSessionRecording: vi.fn(), reset: vi.fn() };
		const storage = memoryStorage({ ph_abc_posthog: '{}', __ph_opt_in_out_abc: '0', keep: '1', [CONSENT_KEY]: 'x' });
		const cookies = { list: ['ph_abc_posthog=1', 'session=2'], expired: [] };
		const doc = {
			get cookie() {
				return cookies.list.join('; ');
			},
			set cookie(v) {
				cookies.expired.push(v.split('=')[0]);
			},
		};
		applyToPosthog('denied', { posthog: ph }, storage, doc);
		expect(ph.opt_out_capturing).toHaveBeenCalled();
		expect(ph.stopSessionRecording).toHaveBeenCalled();
		expect(storage.getItem('ph_abc_posthog')).toBeNull();
		expect(storage.getItem('__ph_opt_in_out_abc')).toBeNull();
		expect(storage.getItem('keep')).toBe('1');
		expect(storage.getItem(CONSENT_KEY)).toBe('x');
		expect(cookies.expired).toContain('ph_abc_posthog');
		expect(cookies.expired).not.toContain('session');
	});

	it('on granted after a reject: opts back in when the library already loaded', () => {
		const ph = { __loaded: true, opt_in_capturing: vi.fn() };
		applyToPosthog('granted', { posthog: ph, __threewsStartAnalytics: vi.fn() }, memoryStorage(), null);
		expect(ph.opt_in_capturing).toHaveBeenCalled();
	});
});
