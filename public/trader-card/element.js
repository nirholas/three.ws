/**
 * <trader-card>: a live three.ws trader, on any page, with a way to act.
 *
 *   <script type="module" src="https://three.ws/trader-card/element.js"></script>
 *   <trader-card agent="6287faf3-d41b-43cb-97bb-d305c1ac6e45"></trader-card>
 *
 * Attributes
 *   agent    (required) the trader agent uuid
 *   window   24h | 7d | 30d | all          default 30d
 *   size     compact | full                default full
 *   theme    auto | light | dark           default auto
 *   ref      referral code carried into every link out
 *   refresh  seconds between refreshes     default 120, 0 disables
 *   origin   override the API origin (self-hosted / staging)
 *
 * A leader's audience is already somewhere else: a stream overlay, a link in
 * bio, a blog post, a Discord embed. This is the piece of three.ws that goes to
 * them. It shows the record the platform will vouch for, the trader's last few
 * results, whatever they are holding right now, and two ways to act: fork the
 * coin into your own wallet, or ghost-copy the trader with no money at risk.
 *
 * It is real DOM in a shadow root, not an image, so it is selectable, screen
 * reader readable, keyboard reachable and themeable, and it cannot inherit
 * broken styling from the host page. It stops polling when the tab is hidden or
 * the card scrolls out of view, because a widget that drains a laptop battery
 * gets deleted from the page it was put on.
 *
 * Nothing here holds funds, asks for a key, or signs anything. Every action is a
 * link back to three.ws, where the visitor's own wallet does the signing.
 */

const WINDOWS = ['24h', '7d', '30d', 'all'];
const SIZES = ['compact', 'full'];
const THEMES = ['auto', 'light', 'dark'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_RE = /^[A-Za-z0-9_-]{1,32}$/;
const FETCH_TIMEOUT_MS = 8000;

// The card is embedded on other people's origins, so the API host is three.ws by
// default rather than wherever the page happens to live.
const DEFAULT_ORIGIN = 'https://three.ws';

export async function fetchTraderCard(agentId, { origin, window: win, ref } = {}) {
	if (!UUID_RE.test(String(agentId || ''))) {
		const err = new Error('not a three.ws agent id');
		err.status = 400;
		throw err;
	}
	const url = new URL('/api/sniper/trader-card', origin || DEFAULT_ORIGIN);
	url.searchParams.set('agent', agentId);
	if (WINDOWS.includes(win)) url.searchParams.set('window', win);
	if (ref && REF_RE.test(ref)) url.searchParams.set('ref', ref);
	const res = await fetch(url, {
		headers: { accept: 'application/json' },
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (!res.ok) {
		const err = new Error(`three.ws answered ${res.status}`);
		err.status = res.status;
		throw err;
	}
	return res.json();
}

/** Signed SOL, scaled so a small number does not render as a row of zeroes. */
export function fmtSol(n) {
	if (n == null || !Number.isFinite(Number(n))) return 'n/a';
	const v = Number(n);
	const abs = Math.abs(v);
	const digits = abs >= 100 ? 1 : abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
	return `${v > 0 ? '+' : v < 0 ? '-' : ''}${abs.toFixed(digits)} SOL`;
}

export function fmtPct(n, { sign = true } = {}) {
	if (n == null || !Number.isFinite(Number(n))) return 'n/a';
	const v = Number(n);
	return `${sign && v > 0 ? '+' : ''}${v.toFixed(v <= -100 || v >= 100 ? 0 : 1)}%`;
}

/** "4m ago" / "3h ago" / "6d ago", or null when the timestamp is unusable. */
export function relativeTime(iso, now = Date.now()) {
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return null;
	const s = Math.max(0, Math.round((now - t) / 1000));
	if (s < 60) return 'just now';
	if (s < 3600) return `${Math.round(s / 60)}m ago`;
	if (s < 86400) return `${Math.round(s / 3600)}h ago`;
	return `${Math.round(s / 86400)}d ago`;
}

const STYLE = `
:host{display:block;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color-scheme:light dark;max-width:420px}
:host([hidden]){display:none}
*{box-sizing:border-box}
.card{--bg:#fff;--panel:#f4f5f9;--text:#0b0b18;--muted:#5b5f73;--line:#e4e6ef;--up:#0f9d58;--down:#d1483f;--accent:#5b57ff;
 position:relative;display:block;width:100%;padding:16px;border:1px solid var(--line);border-radius:18px;
 background:var(--bg);color:var(--text);overflow:hidden}
@media (prefers-color-scheme:dark){.card{--bg:#0b0b16;--panel:#15162a;--text:#f6f7fb;--muted:#a2a7bd;--line:#262842;--up:#34d399;--down:#f87171;--accent:#8b8bff}}
:host([theme="dark"]) .card{--bg:#0b0b16;--panel:#15162a;--text:#f6f7fb;--muted:#a2a7bd;--line:#262842;--up:#34d399;--down:#f87171;--accent:#8b8bff}
:host([theme="light"]) .card{--bg:#fff;--panel:#f4f5f9;--text:#0b0b18;--muted:#5b5f73;--line:#e4e6ef;--up:#0f9d58;--down:#d1483f;--accent:#5b57ff}
.top{display:flex;gap:12px;align-items:center}
.pic{width:44px;height:44px;border-radius:13px;flex:0 0 auto;object-fit:cover;background:linear-gradient(135deg,var(--accent),#00d1ff);
 display:grid;place-items:center;color:#fff;font-weight:700;font-size:18px}
.who{min-width:0;flex:1 1 auto}
.name{font-weight:700;font-size:16px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
 color:inherit;text-decoration:none}
a.name:hover{text-decoration:underline}
a.name:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
.sub{font-size:11.5px;color:var(--muted);margin-top:3px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.badge{font-size:9.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:2px 6px;border-radius:999px;
 background:var(--panel);color:var(--muted);border:1px solid var(--line)}
.badge.ok{color:var(--up);border-color:color-mix(in srgb,var(--up) 40%,var(--line))}
.headline{display:flex;align-items:baseline;gap:8px;margin-top:14px}
.headline b{font-size:28px;line-height:1;font-weight:800;letter-spacing:-.02em}
.headline b.up{color:var(--up)}.headline b.down{color:var(--down)}
.headline span{font-size:12px;color:var(--muted)}
.stats{display:flex;gap:6px;margin-top:12px}
.stat{flex:1 1 0;background:var(--panel);border-radius:11px;padding:7px 9px;min-width:0}
.stat b{display:block;font-size:13.5px;font-variant-numeric:tabular-nums}
.stat span{font-size:9.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.sec{font-size:9.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:14px 0 7px}
.rows{display:flex;flex-direction:column;gap:1px;background:var(--line);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.row{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;background:var(--bg);padding:7px 10px;font-size:12px}
.row .sym{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .sym small{display:block;font-weight:400;font-size:10px;color:var(--muted)}
.row .res{font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap}
.row .res.up{color:var(--up)}.row .res.down{color:var(--down)}
.row a.fork{font-size:11px;text-decoration:none;color:var(--accent);border:1px solid var(--line);border-radius:999px;padding:3px 9px;white-space:nowrap}
.row a.fork:hover{border-color:var(--accent)}
.row a.fork:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.cta{display:flex;gap:8px;margin-top:14px}
.cta a{flex:1 1 0;text-align:center;text-decoration:none;font-size:12.5px;font-weight:600;padding:9px 10px;border-radius:11px;
 border:1px solid var(--line);color:var(--text);background:var(--panel);transition:border-color .15s ease,transform .15s ease}
.cta a.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.cta a:hover{border-color:var(--accent);transform:translateY(-1px)}
.cta a:active{transform:none}
.cta a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.cta a{transition:none}.cta a:hover{transform:none}}
.foot{margin-top:11px;font-size:10.5px;color:var(--muted);display:flex;justify-content:space-between;gap:8px;align-items:center}
.foot a{color:var(--muted);text-decoration:none}
.foot a:hover{color:var(--accent)}
.foot a:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:3px}
.note{font-size:11.5px;color:var(--muted);line-height:1.45;margin:12px 0 0}
button{font:inherit;font-size:12px;padding:6px 12px;border-radius:999px;border:1px solid var(--line);
 background:var(--panel);color:var(--text);cursor:pointer}
button:hover{border-color:var(--accent)}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.skel{animation:pulse 1.4s ease-in-out infinite;background:var(--panel);border-radius:8px;color:transparent}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.55}}
@media (prefers-reduced-motion:reduce){.skel{animation:none}}
.stale{position:absolute;top:10px;right:12px;font-size:9.5px;color:var(--muted)}
:host([size="compact"]) .rows,:host([size="compact"]) .sec{display:none}
:host([size="compact"]) .headline b{font-size:24px}
`;

function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function describe(err) {
	if (err?.status === 404) return 'That trader is not public on three.ws.';
	if (err?.status === 400) return 'That is not a three.ws agent id.';
	return 'Could not reach three.ws just now.';
}

/** Only ever emit links the platform itself produced, on the platform's origin. */
function safeUrl(value, origin) {
	if (!value) return null;
	try {
		const u = new URL(value, origin || DEFAULT_ORIGIN);
		return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
	} catch {
		return null;
	}
}

export class TraderCardElement extends HTMLElement {
	static observedAttributes = ['agent', 'window', 'size', 'theme', 'ref', 'refresh', 'origin'];

	#root = this.attachShadow({ mode: 'open' });
	#timer = null;
	#observer = null;
	#visible = true;
	#card = null;
	#loading = false;

	connectedCallback() {
		if (!this.hasAttribute('size')) this.setAttribute('size', 'full');
		this.#root.innerHTML = `<style>${STYLE}</style><div class="host"></div>`;
		this.#renderSkeleton();
		this.#watchVisibility();
		this.#load();
	}

	disconnectedCallback() {
		this.#stopTimer();
		this.#observer?.disconnect();
		document.removeEventListener('visibilitychange', this.#onVisibility);
	}

	attributeChangedCallback(name, before, after) {
		if (before === after || !this.isConnected) return;
		if (name === 'refresh') return this.#scheduleRefresh();
		if (name === 'size' || name === 'theme') return;
		this.#load();
	}

	get #window() {
		const w = this.getAttribute('window');
		return WINDOWS.includes(w) ? w : '30d';
	}

	get #refreshMs() {
		const seconds = Number(this.getAttribute('refresh'));
		if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
		return 120_000;
	}

	#onVisibility = () => {
		this.#visible = !document.hidden;
		this.#scheduleRefresh();
	};

	#watchVisibility() {
		document.addEventListener('visibilitychange', this.#onVisibility);
		if (typeof IntersectionObserver === 'function') {
			this.#observer = new IntersectionObserver((entries) => {
				const onScreen = entries.some((e) => e.isIntersecting);
				if (onScreen !== this.#visible) {
					this.#visible = onScreen;
					this.#scheduleRefresh();
				}
			});
			this.#observer.observe(this);
		}
	}

	#stopTimer() {
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = null;
	}

	#scheduleRefresh() {
		this.#stopTimer();
		const every = this.#refreshMs;
		if (!every || !this.#visible || !this.isConnected) return;
		this.#timer = setTimeout(() => this.#load(), every);
	}

	async #load() {
		const agent = this.getAttribute('agent');
		if (!agent) return this.#renderError('No agent id set on this element.', false);
		if (this.#loading) return;
		this.#loading = true;
		try {
			const card = await fetchTraderCard(agent, {
				origin: this.getAttribute('origin') || undefined,
				window: this.#window,
				ref: this.getAttribute('ref') || undefined,
			});
			this.#card = card;
			this.#renderCard(card);
			this.dispatchEvent(new CustomEvent('tradercard:load', { detail: card, bubbles: true }));
		} catch (err) {
			// A card that already rendered keeps what it has: a blip must not blank
			// out a working card on someone else's page.
			if (this.#card) this.#renderCard(this.#card, { stale: true });
			else this.#renderError(describe(err), (err?.status ?? 0) !== 400);
			this.dispatchEvent(new CustomEvent('tradercard:error', { detail: err, bubbles: true }));
		} finally {
			this.#loading = false;
			this.#scheduleRefresh();
		}
	}

	#host() {
		return this.#root.querySelector('.host');
	}

	#renderSkeleton() {
		this.#host().innerHTML = `
<div class="card" aria-busy="true" aria-label="Loading trader card">
	<div class="top"><div class="pic skel"></div><div class="who">
		<div class="name skel">Loading trader</div><div class="sub"><span class="skel">Reading the on-chain record</span></div>
	</div></div>
	<div class="headline"><b class="skel">0.00</b><span class="skel">realized</span></div>
	<div class="stats"><div class="stat skel"><b>0</b><span>.</span></div><div class="stat skel"><b>0</b><span>.</span></div><div class="stat skel"><b>0</b><span>.</span></div></div>
</div>`;
	}

	#renderError(message, retryable) {
		this.#host().innerHTML = `
<div class="card" role="group" aria-label="Trader card unavailable">
	<div class="top"><div class="pic" aria-hidden="true">3</div><div class="who">
		<div class="name">Card unavailable</div><div class="sub">three.ws</div>
	</div></div>
	<p class="note">${escapeHtml(message)}</p>
	${retryable ? '<div class="cta"><button type="button" part="retry">Try again</button></div>' : ''}
</div>`;
		this.#host().querySelector('button')?.addEventListener('click', () => {
			this.#renderSkeleton();
			this.#load();
		});
	}

	#renderCard(card, { stale = false } = {}) {
		const origin = this.getAttribute('origin') || DEFAULT_ORIGIN;
		const s = card.stats || {};
		const profile = safeUrl(card.links?.profile, origin);
		const ghost = safeUrl(card.links?.ghost_copy, origin);
		const site = safeUrl(card.links?.site, origin);
		const pnl = s.realized_pnl_sol;
		const dir = pnl > 0 ? 'up' : pnl < 0 ? 'down' : '';
		const usd = s.realized_pnl_usd != null
			? ` (${s.realized_pnl_usd < 0 ? '-' : ''}$${Math.abs(s.realized_pnl_usd).toLocaleString('en-US', { maximumFractionDigits: 2 })})`
			: '';

		const portrait = card.agent.image
			? `<img class="pic" src="${escapeHtml(card.agent.image)}" alt="" loading="lazy" decoding="async">`
			: `<div class="pic" aria-hidden="true">${escapeHtml((card.agent.name || '?').slice(0, 1).toUpperCase())}</div>`;

		const active = relativeTime(s.last_active_at);
		const badges = [
			card.agent.verified ? '<span class="badge ok">Verified</span>' : '',
			`<span class="badge">${escapeHtml(card.window)}</span>`,
			card.agent.copiers > 0 ? `<span>${card.agent.copiers} copying</span>` : '',
			active ? `<span>active ${escapeHtml(active)}</span>` : '',
		].filter(Boolean).join('');

		const tradeRow = (t, kind) => {
			const fork = safeUrl(t.fork_url, origin);
			const value = kind === 'open' ? t.unrealized_pct : t.pnl_pct;
			const cls = value > 0 ? 'up' : value < 0 ? 'down' : '';
			const when = relativeTime(kind === 'open' ? t.opened_at : t.closed_at);
			const sub = kind === 'open'
				? `open${when ? ` ${escapeHtml(when)}` : ''}`
				: `${escapeHtml(String(t.exit_reason || 'closed').replace(/_/g, ' '))}${when ? ` ${escapeHtml(when)}` : ''}${t.moonbag_held ? ' · moon bag' : ''}`;
			return `
	<div class="row">
		<span class="sym">${escapeHtml(t.symbol || 'Unnamed coin')}<small>${sub}</small></span>
		<span class="res ${cls}">${escapeHtml(fmtPct(value))}</span>
		${fork ? `<a class="fork" href="${escapeHtml(fork)}" target="_blank" rel="noopener">Fork</a>` : ''}
	</div>`;
		};

		const openRows = (card.open || []).map((t) => tradeRow(t, 'open')).join('');
		const recentRows = (card.recent || []).map((t) => tradeRow(t, 'closed')).join('');
		const noHistory = !openRows && !recentRows
			? '<p class="note">No settled round-trips in this window yet. Open the profile for the full record.</p>'
			: '';

		this.#host().innerHTML = `
<div class="card" role="group" aria-label="${escapeHtml(`${card.agent.name} on three.ws: ${fmtSol(pnl)} realized over ${card.window}`)}">
	${stale ? '<span class="stale">offline</span>' : ''}
	<div class="top">
		${portrait}
		<div class="who">
			${profile ? `<a class="name" href="${escapeHtml(profile)}" target="_blank" rel="noopener">${escapeHtml(card.agent.name)}</a>`
				: `<div class="name">${escapeHtml(card.agent.name)}</div>`}
			<div class="sub">${badges}</div>
		</div>
	</div>
	<div class="headline"><b class="${dir}">${escapeHtml(fmtSol(pnl))}</b><span>realized${escapeHtml(usd)}</span></div>
	<div class="stats">
		<div class="stat"><b>${escapeHtml(s.win_rate != null ? `${Math.round(s.win_rate * 100)}%` : 'n/a')}</b><span>Win rate</span></div>
		<div class="stat"><b>${escapeHtml(String(s.closed ?? 0))}</b><span>Closed</span></div>
		<div class="stat"><b>${escapeHtml(s.score != null ? String(s.score) : 'n/a')}</b><span>Score</span></div>
	</div>
	${openRows ? `<div class="sec">Holding now</div><div class="rows">${openRows}</div>` : ''}
	${recentRows ? `<div class="sec">Last closed</div><div class="rows">${recentRows}</div>` : ''}
	${noHistory}
	<div class="cta">
		${ghost ? `<a class="primary" href="${escapeHtml(ghost)}" target="_blank" rel="noopener">Ghost-copy</a>` : ''}
		${profile ? `<a href="${escapeHtml(profile)}" target="_blank" rel="noopener">Full record</a>` : ''}
	</div>
	<div class="foot">
		<span>Verified on-chain</span>
		${site ? `<a href="${escapeHtml(site)}" target="_blank" rel="noopener">three.ws</a>` : '<span>three.ws</span>'}
	</div>
</div>`;
	}
}

if (typeof customElements !== 'undefined' && !customElements.get('trader-card')) {
	customElements.define('trader-card', TraderCardElement);
}
