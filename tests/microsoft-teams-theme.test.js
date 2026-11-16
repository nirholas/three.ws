import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { themeFor } from '../src/microsoft-teams-stage/theme.js';

// Teams Store validation guideline (Meeting extensions, "Theme"): apps must use
// the dark theme in meetings, whatever theme the Teams client uses.
describe('themeFor', () => {
	it('forces the dark theme on the meeting stage and side panel even when Teams is light', () => {
		expect(themeFor({ theme: 'default', frameContext: 'meetingStage' })).toEqual({ mode: 'dark', contrast: false });
		expect(themeFor({ theme: 'default', frameContext: 'sidePanel' })).toEqual({ mode: 'dark', contrast: false });
		expect(themeFor({ theme: 'light', frameContext: 'meetingStage' })).toEqual({ mode: 'dark', contrast: false });
	});
	it('keeps high contrast in a meeting', () => {
		expect(themeFor({ theme: 'contrast', frameContext: 'meetingStage' })).toEqual({ mode: 'dark', contrast: true });
	});
	it('follows the Teams theme outside a meeting', () => {
		expect(themeFor({ theme: 'default', frameContext: 'settings' })).toEqual({ mode: 'light', contrast: false });
		expect(themeFor({ theme: 'default', frameContext: 'content' })).toEqual({ mode: 'light', contrast: false });
		expect(themeFor({ theme: 'dark', frameContext: 'content' })).toEqual({ mode: 'dark', contrast: false });
		expect(themeFor({ theme: 'contrast', frameContext: 'content' })).toEqual({ mode: 'dark', contrast: true });
	});
	it('returns null without a theme so the page keeps its boot theme', () => {
		expect(themeFor({ frameContext: 'meetingStage' })).toBeNull();
		expect(themeFor()).toBeNull();
	});
});

// The inline boot script each Teams page runs before first paint, executed as shipped.
describe('boot theme from the tab URL', () => {
	const bootScript = (page) => {
		const html = readFileSync(join(import.meta.dirname, '..', 'pages', page), 'utf8');
		return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes("get('theme')"));
	};
	const boot = (page, search, saved = null) => {
		const attrs = new Map();
		const documentElement = { setAttribute: (k, v) => attrs.set(k, v) };
		const localStorage = { getItem: () => saved };
		const matchMedia = () => ({ matches: false });
		new Function('document', 'location', 'localStorage', 'window', 'URLSearchParams', bootScript(page))(
			{ documentElement },
			{ search },
			localStorage,
			{ matchMedia },
			URLSearchParams,
		);
		return { theme: attrs.get('data-theme'), contrast: attrs.has('data-contrast') };
	};

	for (const page of ['microsoft-teams-tab.html', 'microsoft-teams-stage.html']) {
		it(`${page}: the Teams theme wins over the saved site theme`, () => {
			expect(boot(page, '?theme=default')).toEqual({ theme: 'light', contrast: false });
			expect(boot(page, '?theme=default', 'dark')).toEqual({ theme: 'light', contrast: false });
			expect(boot(page, '?theme=dark', 'light')).toEqual({ theme: 'dark', contrast: false });
			expect(boot(page, '?theme=contrast', 'light')).toEqual({ theme: 'dark', contrast: true });
		});
		it(`${page}: outside Teams the saved site theme applies`, () => {
			expect(boot(page, '', 'light')).toEqual({ theme: 'light', contrast: false });
			expect(boot(page, '', null)).toEqual({ theme: 'dark', contrast: false });
		});
	}
});
