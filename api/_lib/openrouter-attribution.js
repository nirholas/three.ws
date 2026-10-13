// Single source of truth for the headers that make an OpenRouter request count
// toward three.ws's app page and Top Apps ranking (openrouter.ai/rankings).
// HTTP-Referer is the required app identifier; X-OpenRouter-Title is the
// current display-name header, with X-Title kept for callers still on the
// older name. Every OpenRouter call site in this repo must spread this object
// into its request headers instead of inlining its own values, so the title
// three.ws reports never drifts between surfaces.
export const OPENROUTER_ATTRIBUTION_HEADERS = Object.freeze({
	'HTTP-Referer': 'https://three.ws',
	'X-Title': 'three.ws',
	'X-OpenRouter-Title': 'three.ws',
});
