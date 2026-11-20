// What the page shows for each Grok reply: the mood map and the load label.
// Plain ES module, imported by app.js in the browser and by test.mjs in Node.

// mood -> sustained expression (valence -1..1, arousal 0..1) and a one-shot emote
// from https://three.ws/animations/manifest.json.
export const MOOD_MAP = {
	happy: { valence: 0.7, arousal: 0.4, clip: 'nod', label: 'Happy' },
	excited: { valence: 0.9, arousal: 0.85, clip: 'celebrate', label: 'Excited' },
	thoughtful: { valence: 0.1, arousal: 0.3, clip: 'think', label: 'Thoughtful' },
	sad: { valence: -0.6, arousal: 0.2, clip: 'defeated', label: 'Sad' },
	surprised: { valence: 0.3, arousal: 0.9, clip: 'reaction', label: 'Surprised' },
	neutral: { valence: 0, arousal: 0.3, clip: null, label: 'Calm' },
};

export const moodFor = (mood) => MOOD_MAP[mood] || MOOD_MAP.neutral;

// The label beside "Loading Nova" for an agent:load-progress event's detail.pct.
export function loadLabel(pct) {
	const fraction = Math.min(Math.max(Number(pct) || 0, 0), 1);
	const n = Math.round(fraction * 100);
	return n ? `${n}%` : '';
}
