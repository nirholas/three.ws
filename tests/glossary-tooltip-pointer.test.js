// @vitest-environment jsdom
// The shared tooltip popover (#tws-tt-pop, public/glossary.js) must never sit
// between a pointer and the control under it. On /render-lab the "Contact
// sheet" button's tip opened below the button, right over the sheet's
// "Poses" axis button. The popover kept pointer-events on at all times and
// its hover bridge held it open while the pointer was inside it, so a click
// aimed at "Poses" landed on the tip and the pose sheet never opened. The X
// proof reel for the render-lab sheet failed on exactly that click.
//
// Plain tips (attachTip) carry no link, so there is nothing to travel into:
// they take no pointer events and close when their control is pressed. Only a
// glossary term's tip, which carries the "Full glossary" link, stays
// reachable, and only while it is showing.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const glossarySrc = readFileSync(resolve(__dirname, '../public/glossary.js'), 'utf8');
const styleSrc = readFileSync(resolve(__dirname, '../public/style.css'), 'utf8');

// Every rule in style.css whose selector targets the popover itself (not its
// children), so the cascade jsdom computes matches the shipped stylesheet.
function popoverRules() {
	const rules = [];
	const re = /([^{}]*#tws-tt-pop[^{}]*)\{([^{}]*)\}/g;
	let match;
	while ((match = re.exec(styleSrc))) {
		const selectors = match[1].split(',').map((s) => s.replace(/\/\*[\s\S]*?\*\//g, '').trim()).filter((s) => /#tws-tt-pop(?:[.:\[][^\s>+~]*)?$/.test(s));
		if (selectors.length) rules.push(`${selectors.join(',')}{${match[2]}}`);
	}
	return rules.join('\n');
}

function boot() {
	const style = document.createElement('style');
	style.textContent = popoverRules();
	document.head.appendChild(style);
	window.eval(glossarySrc);
}

const pop = () => document.getElementById('tws-tt-pop');
const pointerEvents = (el) => window.getComputedStyle(el).pointerEvents;

beforeEach(() => {
	vi.useFakeTimers();
	document.body.innerHTML = '<main><button id="sheet">Contact sheet</button><button id="poses">Poses</button><p><span data-term="x402">x402</span></p></main>';
	boot();
});

afterEach(() => {
	vi.useRealTimers();
	document.head.innerHTML = '';
	document.body.innerHTML = '';
	delete window.twsGlossary;
	delete window.__twsGlossary;
});

describe('plain tip (attachTip)', () => {
	it('takes no pointer events while showing, so the control beneath it stays clickable', () => {
		const sheet = document.getElementById('sheet');
		window.twsGlossary.attachTip(sheet, 'Render this configuration across every camera framing.', { plain: true });
		sheet.dispatchEvent(new Event('mouseenter'));
		expect(pop().classList.contains('is-on')).toBe(true);
		expect(pointerEvents(pop())).toBe('none');
	});

	it('is not held open by the pointer moving onto it', () => {
		const sheet = document.getElementById('sheet');
		window.twsGlossary.attachTip(sheet, 'Render this configuration across every camera framing.', { plain: true });
		sheet.dispatchEvent(new Event('mouseenter'));
		sheet.dispatchEvent(new Event('mouseleave'));
		pop().dispatchEvent(new Event('mouseenter'));
		vi.advanceTimersByTime(200);
		expect(pop().classList.contains('is-on')).toBe(false);
	});

	it('closes when its control is pressed', () => {
		const sheet = document.getElementById('sheet');
		window.twsGlossary.attachTip(sheet, 'Render this configuration across every camera framing.', { plain: true });
		sheet.dispatchEvent(new Event('mouseenter'));
		sheet.dispatchEvent(new Event('pointerdown'));
		expect(pop().classList.contains('is-on')).toBe(false);
		expect(sheet.hasAttribute('aria-describedby')).toBe(false);
	});
});

describe('glossary term tip', () => {
	it('stays reachable while showing so its Full glossary link can be clicked', () => {
		const term = document.querySelector('[data-term]');
		term.dispatchEvent(new Event('mouseenter'));
		expect(pop().querySelector('a.tws-tt-more')).toBeTruthy();
		expect(pointerEvents(pop())).toBe('auto');
		term.dispatchEvent(new Event('mouseleave'));
		pop().dispatchEvent(new Event('mouseenter'));
		vi.advanceTimersByTime(200);
		expect(pop().classList.contains('is-on')).toBe(true);
	});

	it('takes no pointer events once hidden, even though it stays in the DOM', () => {
		const term = document.querySelector('[data-term]');
		term.dispatchEvent(new Event('mouseenter'));
		term.dispatchEvent(new Event('mouseleave'));
		vi.advanceTimersByTime(200);
		expect(pop().classList.contains('is-on')).toBe(false);
		expect(pointerEvents(pop())).toBe('none');
	});

	it('a plain tip shown after a term tip drops the term tip reachability', () => {
		const term = document.querySelector('[data-term]');
		const sheet = document.getElementById('sheet');
		window.twsGlossary.attachTip(sheet, 'Render this configuration across every camera framing.', { plain: true });
		term.dispatchEvent(new Event('mouseenter'));
		sheet.dispatchEvent(new Event('mouseenter'));
		expect(pointerEvents(pop())).toBe('none');
	});
});
