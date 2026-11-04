// control.js, the caster's input dispatcher. Turns sanitized wire events drained
// from the control channel (/api/agent-screen-control-drain) into real input on
// the live Chromium page via Playwright. Coordinates arrive NORMALIZED (0..1) so
// they map cleanly onto the caster's real viewport regardless of the driver's
// display size.
//
// The API already sanitizes every event, but this module re-clamps coordinates
// and re-guards navigation as defense in depth, the caster never trusts the
// queue blindly.

import { isNavAllowed, assertResolvedPublic } from './egress-guard.js';

export { isNavAllowed };

const VP_DEFAULT = { width: 1280, height: 720 };

const clamp01 = (n) => {
	const v = Number(n);
	if (!Number.isFinite(v)) return 0;
	return v < 0 ? 0 : v > 1 ? 1 : v;
};

// Navigation guard. isNavAllowed (the literal-host filter, a byte-identical
// mirror of the API-side guard) runs first; then the destination's resolved
// addresses are checked through the pool's egress guard, which also re-checks
// every redirect hop and subresource at the browser context. Uses the pool's
// shared, cached guard when one is passed; otherwise resolves directly so the
// check is never skipped.
async function navTargetAllowed(url, guard) {
	if (!isNavAllowed(url)) return false;
	if (guard) return (await guard.checkUrl(url)).ok;
	try {
		await assertResolvedPublic(new URL(url).hostname);
		return true;
	} catch {
		return false;
	}
}

// Map a normalized event's (x,y) to real pixels within the viewport.
function toPixels(ev, vp) {
	return [Math.round(clamp01(ev.x) * (vp.width - 1)), Math.round(clamp01(ev.y) * (vp.height - 1))];
}

// Apply ONE event to the page. Isolated try/catch so a click that lands mid
// navigation (or any transient Playwright error) never aborts the rest of the
// gesture. Returns true if the event likely changed the page enough to warrant an
// immediate fresh frame (click / key / nav), so the driver sees feedback fast.
async function applyOne(page, ev, vp, guard) {
	try {
		switch (ev.t) {
			case 'move': {
				const [x, y] = toPixels(ev, vp);
				await page.mouse.move(x, y);
				return false;
			}
			case 'down': {
				const [x, y] = toPixels(ev, vp);
				await page.mouse.move(x, y);
				await page.mouse.down({ button: ev.button || 'left' });
				return false;
			}
			case 'up': {
				const [x, y] = toPixels(ev, vp);
				await page.mouse.move(x, y);
				await page.mouse.up({ button: ev.button || 'left' });
				return true;
			}
			case 'click': {
				const [x, y] = toPixels(ev, vp);
				await page.mouse.click(x, y, { button: ev.button || 'left' });
				return true;
			}
			case 'scroll': {
				const [x, y] = toPixels(ev, vp);
				await page.mouse.move(x, y);
				await page.mouse.wheel(0, Number(ev.dy) || 0);
				return true;
			}
			case 'key':
				await page.keyboard.press(String(ev.key));
				return true;
			case 'text':
				await page.keyboard.type(String(ev.text), { delay: 12 });
				return true;
			case 'nav':
				if (!(await navTargetAllowed(String(ev.url), guard))) return false;
				await page.goto(String(ev.url), { waitUntil: 'domcontentloaded', timeout: 30_000 });
				return true;
			case 'back':
				await page.goBack({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
				return true;
			case 'forward':
				await page.goForward({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
				return true;
			case 'reload':
				await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
				return true;
			default:
				return false;
		}
	} catch {
		return false;
	}
}

// Apply a batch of drained events in order. Returns { changed } where changed is
// true if any event warrants an immediate frame push. opts.guard is the pool's
// egress guard (createEgressGuard) used to vet 'nav' targets.
export async function applyEvents(page, events, viewport = VP_DEFAULT, { guard = null } = {}) {
	if (!page || page.isClosed?.() || !Array.isArray(events) || !events.length) {
		return { changed: false };
	}
	const vp = {
		width: Number(viewport?.width) || VP_DEFAULT.width,
		height: Number(viewport?.height) || VP_DEFAULT.height,
	};
	let changed = false;
	for (const ev of events) {
		if (page.isClosed?.()) break;
		const c = await applyOne(page, ev, vp, guard);
		changed = changed || c;
	}
	return { changed };
}
