// Theme resolution for the meeting stage, side panel and config page. Pure so
// the Teams Store meeting rule can be unit tested without a Teams host.

/** Frame contexts that render inside a live meeting, where only dark is allowed. */
export const MEETING_CONTEXTS = new Set(['meetingStage', 'sidePanel']);

/**
 * Map a Teams theme name and frame context to the page theme.
 * @param {{ theme?: string, frameContext?: string }} input
 * @returns {{ mode: 'light' | 'dark', contrast: boolean } | null}
 */
export function themeFor({ theme, frameContext } = {}) {
	if (!theme) return null;
	const inMeeting = MEETING_CONTEXTS.has(frameContext);
	const light = !inMeeting && (theme === 'default' || theme === 'light');
	return { mode: light ? 'light' : 'dark', contrast: theme === 'contrast' };
}
