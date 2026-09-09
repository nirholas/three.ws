// Scene Studio: accessible names for the vendored icon-only controls.
//
// The vendored Toolbar (vendor/js/Toolbar.js) builds its translate / rotate /
// scale controls as a <button> whose only child is an <img> carrying a `title`
// and no `alt`. A title on an <img> is not an accessible name for the button
// that wraps it, so all three shipped to screen readers as unlabelled buttons,
// and the pressed state (a `selected` class) was never announced at all.
//
// The animation timeline (vendor/js/Animation.js) has the same problem one step
// worse: its play / pause / stop transport is three 24px <button>s whose only
// child is an inline <svg> with no title at all, so they reached a screen reader
// as three identical unnamed buttons with nothing to tell them apart.
//
// Both fixes run over the mounted DOM once, reading labels from the same
// `editor.strings` table the vendor uses for its own copy, so a translated UI
// stays translated. Sibling module: it edits the live DOM, never vendor/**.

const MODE_KEYS = ['translate', 'rotate', 'scale'];

/**
 * Label the transform-mode buttons and keep aria-pressed in sync.
 * @param {import('./vendor/js/Editor.js').Editor} editor
 * @param {HTMLElement} toolbarDom the Toolbar instance's `.dom`.
 */
export function enhanceToolbarA11y(editor, toolbarDom) {
	toolbarDom.setAttribute('role', 'toolbar');
	toolbarDom.setAttribute('aria-label', 'Transform mode');

	const buttons = MODE_KEYS.map((mode) => {
		// Matched on the icon the vendor assigns, not on child order, so adding
		// a control to the vendored toolbar can never silently relabel these.
		const icon = toolbarDom.querySelector(`img[src$="/${mode}.svg"]`);
		const button = icon?.closest('button');
		if (!button) return null;
		// The vendor's own tooltip string, e.g. "translate" / "rotate" / "scale".
		const label = (icon?.title || mode).trim() || mode;

		// A decorative alt keeps the icon out of the accessibility tree so the
		// button's own label is what gets announced, rather than both.
		if (icon && !icon.hasAttribute('alt')) icon.setAttribute('alt', '');

		button.setAttribute('aria-label', label);
		button.setAttribute('type', 'button');
		if (!button.title) button.title = label;
		return { mode, button };
	}).filter(Boolean);

	const sync = () => {
		for (const { button } of buttons) {
			button.setAttribute('aria-pressed', String(button.classList.contains('selected')));
		}
	};

	// The vendor swaps the `selected` class inside its own handler for this
	// signal; listening after it was added means we always read the new state.
	editor.signals.transformModeChanged.add(sync);
	sync();

	return buttons.map(({ button }) => button);
}

// The vendored transport icons, keyed by the SVG geometry Animation.js draws.
// Matched on the shape rather than on child order, for the same reason the
// toolbar above matches on the icon file: a control added to the vendored panel
// must never be able to silently inherit one of these labels. A re-vendor that
// redraws an icon leaves that one button unlabelled (what it is today) instead
// of mislabelled, which is the safer way to fail.
const TRANSPORT = [
	{ selector: 'path[d="M3 1.5v9l7-4.5z"]', stringKey: 'sidebar/animations/play', fallback: 'Play' },
	// Upstream ships no `sidebar/animations/pause` key (the sidebar it was
	// written for has no pause control), so this one label stays English until
	// the vendored table grows one.
	{ selector: 'path[d="M2 1h3v10H2zM7 1h3v10H7z"]', stringKey: null, fallback: 'Pause' },
	{ selector: 'rect[x="2"][y="2"]', stringKey: 'sidebar/animations/stop', fallback: 'Stop' },
];

/**
 * Label the animation timeline's play / pause / stop buttons.
 * @param {import('./vendor/js/Editor.js').Editor} editor
 * @param {HTMLElement} animationDom the Animation instance's `.dom`.
 * @returns {HTMLButtonElement[]} the buttons that were labelled.
 */
export function enhanceAnimationA11y(editor, animationDom) {
	const labelled = [];

	for (const { selector, stringKey, fallback } of TRANSPORT) {
		const button = animationDom.querySelector(selector)?.closest('button');
		if (!button) continue;

		// Strings.getKey answers '???' for a key the active language lacks, which
		// would be a worse accessible name than the English word.
		const translated = stringKey ? editor.strings.getKey(stringKey) : null;
		const label = translated && translated !== '???' ? translated : fallback;

		button.setAttribute('type', 'button');
		button.setAttribute('aria-label', label);
		if (!button.title) button.title = label;
		labelled.push(button);
	}

	return labelled;
}
