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
