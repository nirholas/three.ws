import { el, button, skeleton, notice } from './dom.js';
import { formatDistance, arrowGlyph, clampName } from '../../irl/glasses/protocol.js';

export function scanningView() {
	return el('section', {}, el('h1', { class: 'g-title', text: 'Looking around' }), el('p', { class: 'g-sub', text: 'Finding agents near you' }), skeleton(3));
}

export function startView(onStart) {
	return notice('three.ws Glass', 'Pinch to share your location and meet agents standing nearby.', button('Pinch to start', onStart, { 'data-glass-item': '' }));
}

export function deniedView(code, onRetry) {
	const text = {
		denied: 'Location is off for this app. Enable it in the glasses settings, then try again.',
		unavailable: 'Location is unavailable right now. Move to open air and try again.',
		timeout: 'Location took too long. Try again.',
	}[code] || 'Location could not be read.';
	return notice('Location needed', text, button('Try again', onRetry, { 'data-glass-item': '' }));
}

export function offlineView(onRetry) {
	return notice('No connection', 'Reconnect your phone to the glasses, then retry.', button('Retry', onRetry, { 'data-glass-item': '' }));
}

export function errorView(message, onRetry) {
	return notice('Something went wrong', message, button('Retry', onRetry, { 'data-glass-item': '' }));
}

export function nearbyView(pins, relBearing, onOpen) {
	if (!pins.length) {
		return notice('Nobody here yet', 'No agents within 60 m. Walk a little and this updates by itself.');
	}
	const nearest = pins[0];
	const rel = relBearing(nearest);
	return el('section', {},
		el('h1', { class: 'g-title', text: `${pins.length} nearby` }),
		rel == null
			? el('p', { class: 'g-sub g-alert', text: 'Move the glasses in a figure eight to calibrate the compass' })
			: el('div', { class: 'g-arrow', 'aria-hidden': 'true', text: arrowGlyph(rel) }),
		el('ul', { class: 'g-list' }, pins.slice(0, 6).map((p) =>
			el('li', {}, el('button', { type: 'button', class: 'g-item', 'data-glass-item': '', onclick: () => onOpen(p) },
				el('span', { text: clampName(p.avatar_name || 'Agent', 18) }),
				el('span', { class: 'g-dist', text: formatDistance(p.distance_m) }))))));
}

export function cardView(pin, card, handlers) {
	const agent = (card && card.agent) || {};
	const rep = card && card.reputation;
	const services = (card && card.services) || [];
	return el('section', {},
		el('h1', { class: 'g-title', text: clampName(agent.name || pin.avatar_name || 'Agent', 24) }),
		(agent.bio || pin.caption) ? el('p', { class: 'g-sub', text: String(agent.bio || pin.caption).slice(0, 140) }) : null,
		rep && rep.available ? el('p', { class: 'g-sub', text: `Reputation ${rep.score} (${rep.tier})` }) : null,
		services.length ? el('p', { class: 'g-sub', text: `${services.length} paid service${services.length === 1 ? '' : 's'}, open on your phone` }) : null,
		el('div', { class: 'g-row' },
			button('Talk', handlers.onTalk, { 'data-glass-item': '' }),
			button('Open on phone', handlers.onHandoff, { 'data-glass-item': '' }),
			button('Back', handlers.onBack, { 'data-glass-item': '' })));
}

export function talkView(state, handlers) {
	const kids = [
		el('h1', { class: 'g-title', text: clampName(state.name, 24) }),
		el('div', { class: 'g-reply', 'aria-live': 'polite', text: state.reply || (state.busy ? '' : 'Pick a reply to start talking.') }),
	];
	if (state.busy && !state.reply) kids.push(skeleton(1));
	if (state.error) kids.push(el('p', { class: 'g-alert', text: state.error }));
	const options = state.suggestions && state.suggestions.length ? state.suggestions : (state.reply ? [] : ['Hi', 'What do you do?', 'Tell me more']);
	kids.push(el('div', { class: 'g-row' },
		options.map((s) => button(s, () => handlers.onSend(s), { 'data-glass-item': '', disabled: state.busy ? true : null })),
		button('Back', handlers.onBack, { 'data-glass-item': '' })));
	return el('section', {}, kids);
}

export function handoffView(state, handlers) {
	if (state.loading) return el('section', {}, el('h1', { class: 'g-title', text: 'Sending to phone' }), skeleton(2));
	if (state.error) return notice('Could not hand off', state.error, button('Retry', handlers.onRetry, { 'data-glass-item': '' }), button('Back', handlers.onBack, { 'data-glass-item': '' }));
	return el('section', {},
		el('h1', { class: 'g-title', text: 'Open on your phone' }),
		el('p', { class: 'g-sub', text: 'Visit this address, valid for 10 minutes' }),
		el('div', { class: 'g-code', text: state.code }),
		el('p', { class: 'g-sub', text: state.url }),
		button('Back', handlers.onBack, { 'data-glass-item': '' }));
}
