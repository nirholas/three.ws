// <engine-qa>: the real-time-engine fitness grade, rendered.
//
// One custom element shared by /viewer and Rig Doctor, same split of
// responsibility as <sim-readiness> (public/sim-readiness-panel.js): this
// element owns presentation only, the caller decides where the report comes
// from and drives it through four methods.
//
//   el.loading()                      a grade is on the way
//   el.showReport(report, meta)       a report from gradeEngineQa() or
//                                      gradeEngineQaClient(): any verdict
//   el.ungraded({ onGrade })          no grade for these bytes yet, offer one
//   el.failed(message, { onRetry })   the lookup itself failed
//
// `report.partial` (set by the browser-only src/engine-qa-client.js grader)
// marks a report whose triangleBudget and collider checks are `skip`:
// Rig Doctor's file never left the tab to get this far, and those two checks
// need the server's LOD builder and manifold analyzer. When `meta.onUpgrade`
// is supplied, the panel renders an explicit "Check LOD & collider fitness"
// action in their place, naming the upload plainly, rather than silently
// posting the file or silently hiding the two checks the visitor came for.
//
// Shadow DOM for the same reason <sim-readiness> uses it: two hosts, two
// completely different cascades, one element that must never drift.
//
// Spec: specs/ENGINE_QA.md. Guide: /docs/engine-qa.

const VERDICTS = {
	pass: { label: 'Engine ready', glyph: '✓', tone: 'good', lead: 'Draw calls, materials, and texel density all sit inside the real-time budget.' },
	warn: { label: 'Needs tuning', glyph: '⚠', tone: 'warn', lead: 'Nothing here breaks on import, but at least one check is past the comfortable range for a 60fps target.' },
	fail: { label: 'Will stutter', glyph: '✕', tone: 'bad', lead: 'At least one check is past the band a real-time engine can absorb without dropping frames or splitting batches.' },
	skip: { label: 'Engine QA', glyph: '◇', tone: 'dim', lead: 'Nothing measurable yet.' },
};

const CSS = `
:host { position: relative; display: inline-block; font: inherit; --eq-good: #34c76d; --eq-near: #6ea8fe; --eq-warn: #f0b429; --eq-bad: #ff5656; --eq-dim: #9aa3b2; }
:host([hidden]) { display: none; }
* { box-sizing: border-box; }

.badge {
	display: inline-flex; align-items: center; gap: 6px;
	appearance: none; cursor: pointer; font: inherit;
	font-size: 11.5px; font-weight: 700; letter-spacing: .01em; line-height: 1;
	border-radius: 999px; padding: 5px 10px; white-space: nowrap;
	color: var(--eq-dim); background: rgba(127, 140, 160, .12);
	border: 1px solid rgba(127, 140, 160, .28);
	transition: background .15s ease, border-color .15s ease, transform .06s ease, color .15s ease;
}
.badge:hover { background: rgba(127, 140, 160, .2); }
.badge:active { transform: translateY(1px); }
.badge:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.badge[disabled] { cursor: default; }
.badge[disabled]:hover { background: rgba(127, 140, 160, .12); }
.badge .glyph { font-size: 12px; line-height: 1; }
.badge .caret { font-size: 9px; opacity: .7; transition: transform .18s ease; }
.badge[aria-expanded="true"] .caret { transform: rotate(180deg); }

.badge.good { color: var(--eq-good); background: rgba(52, 199, 109, .13); border-color: rgba(52, 199, 109, .36); }
.badge.good:hover { background: rgba(52, 199, 109, .22); }
.badge.warn { color: var(--eq-warn); background: rgba(240, 180, 41, .13); border-color: rgba(240, 180, 41, .38); }
.badge.warn:hover { background: rgba(240, 180, 41, .22); }
.badge.bad { color: var(--eq-bad); background: rgba(255, 86, 86, .13); border-color: rgba(255, 86, 86, .36); }
.badge.bad:hover { background: rgba(255, 86, 86, .22); }

.skeleton {
	display: inline-block; width: 128px; height: 23px; border-radius: 999px;
	background: linear-gradient(90deg, rgba(127,140,160,.10) 25%, rgba(127,140,160,.22) 50%, rgba(127,140,160,.10) 75%);
	background-size: 240% 100%; animation: sweep 1.25s ease-in-out infinite;
}
@keyframes sweep { from { background-position: 120% 0; } to { background-position: -120% 0; } }

.panel {
	position: fixed; top: 0; left: 0; z-index: 2147483000;
	margin: 0; inset: auto; overflow: auto;
	width: max-content; min-width: 250px; max-width: min(480px, calc(100vw - 24px));
	max-height: 60vh; overflow-y: auto; overscroll-behavior: contain;
	border: 1px solid rgba(127, 140, 160, .28); border-radius: 12px;
	background: #12141a; color: #e8eaf0;
	padding: 12px 13px; font-size: 12.5px; line-height: 1.5; text-align: left;
	opacity: 0; transform: translateY(-4px); transition: opacity .18s ease, transform .18s ease;
}
.panel[hidden] { display: none; }
.panel.open { opacity: 1; transform: translateY(0); }
.panel { box-shadow: 0 12px 34px rgba(0, 0, 0, .38); }
.panel[popover] { display: none; border-width: 1px; padding: 12px 13px; }
.panel[popover]:popover-open { display: block; }
.panel[popover]::backdrop { background: transparent; }
.panel.fallback { position: absolute; top: calc(100% + 8px); left: 0; }
:host([align="end"]) .panel.fallback { left: auto; right: 0; }
@media (prefers-reduced-motion: reduce) {
	.panel { transition: none; }
	.skeleton { animation: none; }
}
@media (prefers-color-scheme: light) {
	.panel { background: #fff; color: #14161c; border-color: rgba(20, 22, 28, .16); box-shadow: 0 8px 28px rgba(20, 22, 28, .12); }
}
:host([data-theme="light"]) .panel { background: #fff; color: #14161c; border-color: rgba(20, 22, 28, .16); box-shadow: 0 8px 28px rgba(20, 22, 28, .12); }
:host([data-theme="light"]) .badge { color: #5b6470; background: rgba(20, 22, 28, .06); border-color: rgba(20, 22, 28, .16); }
:host([data-theme="light"]) .badge.good { color: #157f45; background: rgba(52, 199, 109, .14); border-color: rgba(52, 199, 109, .4); }
:host([data-theme="light"]) .badge.warn { color: #8a5d00; background: rgba(240, 180, 41, .18); border-color: rgba(240, 180, 41, .45); }
:host([data-theme="light"]) .badge.bad { color: #b3231f; background: rgba(255, 86, 86, .14); border-color: rgba(255, 86, 86, .4); }
:host([data-theme="light"]) { --eq-dim: #6b7280; --eq-warn: #8a5d00; }
:host([data-theme="dark"]) .panel { background: #12141a; color: #e8eaf0; border-color: rgba(127, 140, 160, .28); box-shadow: 0 12px 34px rgba(0, 0, 0, .38); }
:host([data-theme="dark"]) { --eq-dim: #9aa3b2; --eq-warn: #f0b429; }

.lead { margin: 0 0 10px; }
h3 { margin: 12px 0 5px; font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--eq-dim); }
h3:first-of-type { margin-top: 0; }
p.note { margin: 2px 0 0; color: var(--eq-dim); }

dl { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 12px; margin: 0; }
dt { color: var(--eq-dim); min-width: 0; }
dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
dd.good { color: var(--eq-good); }
dd.warn { color: var(--eq-warn); }
dd.bad { color: var(--eq-bad); }

.lod-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; padding: 3px 0; border-top: 1px solid rgba(127, 140, 160, .14); }
.lod-row:first-child { border-top: 0; }

.foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; padding-top: 9px; border-top: 1px solid rgba(127, 140, 160, .2); color: var(--eq-dim); font-size: 11px; }
.foot .spacer { flex: 1 1 auto; }
button.link, a.link {
	appearance: none; border: 0; background: none; padding: 0; cursor: pointer;
	font: inherit; font-size: 11px; color: inherit; text-decoration: underline;
	text-underline-offset: 2px; transition: color .15s ease;
}
button.link:hover, a.link:hover { color: var(--eq-near); }
button.link:focus-visible, a.link:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; border-radius: 3px; }
button.link[disabled] { cursor: progress; opacity: .7; }

.action {
	appearance: none; cursor: pointer; font: inherit; font-size: 11.5px; font-weight: 600;
	color: inherit; background: rgba(110, 168, 254, .16); border: 1px solid rgba(110, 168, 254, .42);
	border-radius: 8px; padding: 5px 10px; margin: 6px 0 0;
	transition: background .15s ease, transform .06s ease;
	display: inline-flex; align-items: center; gap: 6px;
}
.action:hover { background: rgba(110, 168, 254, .28); }
.action:active { transform: translateY(1px); }
.action:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.action[disabled] { opacity: .6; cursor: progress; }
.row { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 2px; }
`;

function dl(rows) {
	return rows.length
		? `<dl>${rows.map(([k, val, cls]) => `<dt>${k}</dt><dd${cls ? ` class="${cls}"` : ''}>${val}</dd>`).join('')}</dl>`
		: '';
}

class EngineQaCard extends HTMLElement {
	constructor() {
		super();
		this._report = null;
		this._meta = {};
		this._open = false;
		this.attachShadow({ mode: 'open' });
		const style = document.createElement('style');
		style.textContent = CSS;
		this._head = document.createElement('div');
		this._panel = document.createElement('div');
		this._panel.className = 'panel';
		this._panel.hidden = true;
		this._popover = typeof this._panel.showPopover === 'function';
		if (this._popover) this._panel.setAttribute('popover', 'manual');
		else this._panel.classList.add('fallback');
		this.shadowRoot.append(style, this._head, this._panel);
	}

	connectedCallback() {
		this._followTheme();
		if (!this._head.hasChildNodes()) this.loading();
	}

	_followTheme() {
		const root = document.documentElement;
		const sync = () => {
			const theme = root.getAttribute('data-theme');
			if (theme === 'light' || theme === 'dark') this.setAttribute('data-theme', theme);
			else this.removeAttribute('data-theme');
		};
		sync();
		if (this._themeObserver) return;
		this._themeObserver = new MutationObserver(sync);
		this._themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
	}

	/** A grade is on the way. Occupies exactly the badge's footprint. */
	loading() {
		this._report = null;
		this._collapse();
		this._head.innerHTML = '<span class="skeleton" role="status" aria-label="Checking real-time-engine fitness"></span>';
		this._panel.innerHTML = '';
		this.hidden = false;
	}

	/**
	 * Render a report from gradeEngineQa() (full) or gradeEngineQaClient() (partial).
	 * @param {object} report
	 * @param {{ gradedAt?: string, sourceUrl?: string, stlUrl?: string, onUpgrade?: Function, onDownloadStl?: Function }} [meta]
	 */
	showReport(report, meta = {}) {
		if (!report || !report.checks) {
			this.failed('That grade could not be read.', meta);
			return;
		}
		this._report = report;
		this._meta = meta;
		const v = VERDICTS[report.overall] || VERDICTS.skip;
		this._head.innerHTML = '';
		const badge = document.createElement('button');
		badge.type = 'button';
		badge.className = `badge ${v.tone === 'dim' ? '' : v.tone}`;
		badge.setAttribute('aria-expanded', 'false');
		badge.innerHTML = `<span class="glyph" aria-hidden="true">${v.glyph}</span><span>${v.label}</span><span class="caret" aria-hidden="true">▾</span>`;
		badge.title = 'Engine QA: draw calls, materials, texel density, LOD budget, and collider fitness';
		badge.addEventListener('click', () => this._toggle());
		this._head.append(badge);
		this._badge = badge;
		this._panel.innerHTML = this._panelHtml(report, v);
		this._wirePanel();
		this.hidden = false;
	}

	/** No grade exists for these bytes yet. An offer, never an error. */
	ungraded({ onGrade } = {}) {
		this._report = null;
		this._collapse();
		this._panel.innerHTML = '';
		this._head.innerHTML = '';
		const badge = document.createElement('button');
		badge.type = 'button';
		badge.className = 'badge';
		badge.innerHTML = '<span class="glyph" aria-hidden="true">◇</span><span>Check engine fitness</span>';
		badge.title = 'Measure draw calls, materials, texel density, LOD budget, and collider fitness';
		if (typeof onGrade === 'function') {
			badge.addEventListener('click', () => {
				this.loading();
				onGrade();
			});
		} else {
			badge.disabled = true;
		}
		this._head.append(badge);
		this.hidden = false;
	}

	/** The lookup itself failed. Says what happened and offers the retry. */
	failed(message, { onRetry } = {}) {
		this._report = null;
		this._collapse();
		this._panel.innerHTML = '';
		this._head.innerHTML = '';
		const wrap = document.createElement('span');
		wrap.className = 'row';
		const badge = document.createElement('button');
		badge.type = 'button';
		badge.className = 'badge bad';
		badge.disabled = true;
		badge.innerHTML = '<span class="glyph" aria-hidden="true">⚠</span><span>Grade unavailable</span>';
		badge.title = message || 'The engine QA grade could not be fetched.';
		wrap.append(badge);
		if (typeof onRetry === 'function') {
			const retry = document.createElement('button');
			retry.type = 'button';
			retry.className = 'action';
			retry.textContent = 'Try again';
			retry.addEventListener('click', () => {
				this.loading();
				onRetry();
			});
			wrap.append(retry);
		}
		this._head.append(wrap);
		this.hidden = false;
	}

	disconnectedCallback() {
		this._unbind();
		this._themeObserver?.disconnect();
		this._themeObserver = null;
	}

	_bind() {
		if (this._bound) return;
		this._bound = () => this._place();
		window.addEventListener('scroll', this._bound, { passive: true, capture: true });
		window.addEventListener('resize', this._bound, { passive: true });
		this._onKey = (e) => { if (e.key === 'Escape' && this._open) { this._collapse(); this._badge?.focus(); } };
		document.addEventListener('keydown', this._onKey);
		this._onAway = (e) => {
			if (!this._open) return;
			const path = e.composedPath();
			if (path.includes(this._panel) || path.includes(this._badge)) return;
			this._collapse();
		};
		document.addEventListener('pointerdown', this._onAway, true);
	}

	_unbind() {
		if (this._bound) {
			window.removeEventListener('scroll', this._bound, { capture: true });
			window.removeEventListener('resize', this._bound);
			this._bound = null;
		}
		if (this._onKey) {
			document.removeEventListener('keydown', this._onKey);
			this._onKey = null;
		}
		if (this._onAway) {
			document.removeEventListener('pointerdown', this._onAway, true);
			this._onAway = null;
		}
	}

	_place() {
		if (!this._open || !this._badge || !this._popover) return;
		const anchor = this._badge.getBoundingClientRect();
		const gap = 8;
		const margin = 12;
		const box = this._panel.getBoundingClientRect();
		const preferEnd = this.getAttribute('align') === 'end';
		let left = preferEnd ? anchor.right - box.width : anchor.left;
		left = Math.min(left, window.innerWidth - box.width - margin);
		left = Math.max(margin, left);
		const below = window.innerHeight - anchor.bottom - gap - margin;
		const above = anchor.top - gap - margin;
		const flip = below < box.height && above > below;
		const top = flip
			? Math.max(margin, anchor.top - gap - box.height)
			: Math.min(anchor.bottom + gap, window.innerHeight - box.height - margin);
		this._panel.style.left = `${Math.round(left)}px`;
		this._panel.style.top = `${Math.round(Math.max(margin, top))}px`;
		this._panel.style.maxHeight = `${Math.round(Math.max(160, (flip ? above : below)))}px`;
	}

	_show() {
		if (this._popover) {
			this._panel.hidden = false;
			try { this._panel.showPopover(); return; } catch { /* already open */ }
		}
		this._panel.hidden = false;
	}

	_hide() {
		if (this._popover) {
			try { this._panel.hidePopover(); } catch { /* already closed */ }
		}
		this._panel.hidden = true;
	}

	_collapse() {
		this._open = false;
		this._panel.classList.remove('open');
		this._hide();
		this._badge?.setAttribute('aria-expanded', 'false');
		this._unbind();
	}

	_toggle() {
		this._open = !this._open;
		this._badge.setAttribute('aria-expanded', this._open ? 'true' : 'false');
		if (this._open) {
			this._show();
			this._place();
			this._bind();
			requestAnimationFrame(() => {
				this._panel.classList.add('open');
				this._place();
			});
		} else {
			this._panel.classList.remove('open');
			this._hide();
			this._unbind();
		}
	}

	_verdictCls(v) {
		return v === 'fail' ? 'bad' : v === 'warn' ? 'warn' : v === 'pass' ? 'good' : '';
	}

	_panelHtml(r, v) {
		const c = r.checks;
		const core = [
			['Draw calls', `${c.drawCalls.value} (good ≤${c.drawCalls.thresholds.good}, warn ≤${c.drawCalls.thresholds.warn})`, this._verdictCls(c.drawCalls.verdict)],
			['Materials', `${c.materialCount.value} (good ≤${c.materialCount.thresholds.good}, warn ≤${c.materialCount.thresholds.warn})`, this._verdictCls(c.materialCount.verdict)],
		];
		if (r.textureCount != null) core.push(['Textures', String(r.textureCount), '']);
		if (c.texelDensity.verdict !== 'skip') {
			core.push(['Texel density', `${c.texelDensity.value} px/m`, this._verdictCls(c.texelDensity.verdict)]);
		}

		const needsUpgrade = r.partial === true && c.triangleBudget.verdict === 'skip' && c.collider.verdict === 'skip';
		let lodHtml = '';
		if (Array.isArray(c.triangleBudget.value)) {
			lodHtml = `<h3>LOD triangle budget</h3>${c.triangleBudget.value
				.map((l) => `<div class="lod-row"><span>${l.name}</span><span class="${this._verdictCls(l.verdict)}">${l.triangleCount.toLocaleString()} / ${l.budget.toLocaleString()}</span></div>`)
				.join('')}${c.triangleBudget.monotonicDecrease === false ? '<p class="note">Levels are not strictly decreasing.</p>' : ''}`;
		} else if (c.triangleBudget.verdict === 'skip' && !needsUpgrade) {
			lodHtml = `<h3>LOD triangle budget</h3><p class="note">${c.triangleBudget.reason || 'No LOD chain supplied.'}</p>`;
		}

		let colliderHtml = '';
		if (c.collider.value) {
			const cv = c.collider.value;
			colliderHtml = `<h3>Collider fitness</h3>${dl([
				['Watertight', cv.watertight ? 'yes' : 'no', cv.watertight ? 'good' : 'bad'],
				['Shells', String(cv.shells), ''],
				['Triangles', `${cv.triangleCount.toLocaleString()} / ${cv.budget.toLocaleString()}`, this._verdictCls(c.collider.verdict)],
			])}${c.collider.reason ? `<p class="note">${c.collider.reason}</p>` : ''}`;
		} else if (c.collider.verdict === 'skip' && !needsUpgrade) {
			colliderHtml = `<h3>Collider fitness</h3><p class="note">${c.collider.reason || 'Not measured.'}</p>`;
		}

		const upgradeHtml = needsUpgrade && typeof this._meta.onUpgrade === 'function'
			? `<h3>LOD budget &amp; collider fitness</h3><p class="note">Not measured yet: this needs a real LOD build and the server's manifold analyzer.</p><button type="button" class="action" data-upgrade>Check LOD &amp; collider fitness (uploads this file)</button>`
			: '';

		const stlHtml = r.checks.collider?.value?.watertight
			? (this._meta.stlUrl
				? `<a class="link" href="${this._meta.stlUrl}" target="_blank" rel="noopener">Download STL</a>`
				: typeof this._meta.onDownloadStl === 'function'
					? `<button class="link" type="button" data-stl>Download STL</button>`
					: '')
			: '';

		const when = this._meta.gradedAt ? new Date(this._meta.gradedAt) : null;
		const stamp = when && !Number.isNaN(when.valueOf())
			? `Graded ${when.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
			: r.partial ? 'Graded in your browser' : 'Graded on three.ws';

		return `
			<p class="lead">${v.lead}</p>
			${dl(core)}
			${lodHtml}
			${colliderHtml}
			${upgradeHtml}
			<div class="foot">
				<span>${stamp}</span>
				<span class="spacer"></span>
				${stlHtml}
				<button class="link" type="button" data-copy>Copy JSON</button>
				<a class="link" href="/docs/engine-qa" target="_blank" rel="noopener">What this means</a>
			</div>`;
	}

	_wirePanel() {
		const copy = this._panel.querySelector('[data-copy]');
		if (copy) {
			copy.addEventListener('click', async () => {
				const text = JSON.stringify(this._report, null, 2);
				try {
					await navigator.clipboard.writeText(text);
					copy.textContent = 'Copied';
				} catch {
					copy.textContent = 'Press ⌘C to copy';
					const ta = document.createElement('textarea');
					ta.value = text;
					ta.style.position = 'fixed';
					ta.style.opacity = '0';
					document.body.append(ta);
					ta.select();
					try { document.execCommand('copy'); copy.textContent = 'Copied'; } catch { /* the selection is still there to copy by hand */ }
					ta.remove();
				}
				setTimeout(() => { copy.textContent = 'Copy JSON'; }, 2000);
			});
		}

		const upgrade = this._panel.querySelector('[data-upgrade]');
		if (upgrade && typeof this._meta.onUpgrade === 'function') {
			upgrade.addEventListener('click', () => {
				upgrade.disabled = true;
				upgrade.textContent = 'Checking…';
				this._meta.onUpgrade();
			});
		}

		const stl = this._panel.querySelector('[data-stl]');
		if (stl && typeof this._meta.onDownloadStl === 'function') {
			stl.addEventListener('click', () => {
				stl.disabled = true;
				const label = stl.textContent;
				stl.textContent = 'Preparing…';
				Promise.resolve(this._meta.onDownloadStl()).finally(() => {
					stl.disabled = false;
					stl.textContent = label;
				});
			});
		}
	}
}

if (!customElements.get('engine-qa')) customElements.define('engine-qa', EngineQaCard);

export { EngineQaCard, VERDICTS };
