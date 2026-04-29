/**
 * Animation selector panel component.
 * Renders a grid of animation buttons with active state highlighting.
 * @param {object} props
 * @param {Array<{name: string, label?: string, icon?: string, loaded: boolean}>} props.animations
 * @param {string|null} props.active - Currently playing animation name
 * @returns {string} HTML string
 */
export function AnimationPanel({ animations, active }) {
	if (!animations || animations.length === 0) {
		return '<div class="anim-panel anim-panel--empty"></div>';
	}

	const ICONS = {
		idle: '🧍',
		breathing: '🧍',
		standing: '🧍',
		walking: '🚶',
		walk: '🚶',
		running: '🏃',
		run: '🏃',
		waving: '👋',
		wave: '👋',
		dancing: '💃',
		dance: '💃',
		sitting: '🪑',
		sit: '🪑',
		jumping: '🦘',
		jump: '🦘',
		talking: '🗣️',
		talk: '🗣️',
		clapping: '👏',
		clap: '👏',
		punching: '👊',
		punch: '👊',
		kicking: '🦵',
		kick: '🦵',
	};

	const buttons = animations
		.map(({ name, label, icon, loaded }) => {
			const isActive = active === name;
			const displayIcon = icon || ICONS[name.toLowerCase()] || '▶';
			const displayLabel = label || name.charAt(0).toUpperCase() + name.slice(1);
			const activeClass = isActive ? ' anim-btn--active' : '';
			const loadingClass = !loaded ? ' anim-btn--loading' : '';
			return (
				`<button class="anim-btn${activeClass}${loadingClass}" ` +
				`data-anim="${name}" ` +
				`title="${displayLabel}"` +
				`${!loaded ? ' disabled' : ''}>` +
				`<span class="anim-btn__icon">${displayIcon}</span>` +
				`<span class="anim-btn__label">${displayLabel}</span>` +
				`</button>`
			);
		})
		.join('');

	return (
		`<div class="anim-panel">` +
		`<div class="anim-panel__header">` +
		`<span class="anim-panel__title">Animations</span>` +
		`<button class="anim-panel__stop" title="Stop all">⏹</button>` +
		`</div>` +
		`<div class="anim-panel__grid">${buttons}</div>` +
		`</div>`
	);
}
