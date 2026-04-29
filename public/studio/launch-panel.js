// Launch panel for the character studio right column.
// Adds a "launch a token for this agent" form with bonding-curve progress visual.
//
// Public API (pure, testable without DOM):
//   validateLaunchForm(fields)            → { ok, errors }
//   handleLaunchSubmit(fields, onSubmit)  → { ok, errors? }
//
// DOM:
//   mountLaunchPanel(container, opts)     → teardown()

const FEE_TIERS = [
	['standard', 'Standard (0.25%)'],
	['boosted', 'Boosted (0.5%)'],
	['premium', 'Premium (1%)'],
];

/** Validate launch form fields. Returns { ok, errors } — no DOM side-effects. */
export function validateLaunchForm({ name, symbol, description, initialBuy } = {}) {
	const errors = {};
	if (!name?.trim()) errors.name = 'Token name is required';
	if (!symbol?.trim()) errors.symbol = 'Symbol is required';
	if (!description?.trim()) errors.description = 'Description is required';
	if (initialBuy !== '' && initialBuy != null) {
		const n = Number(initialBuy);
		if (isNaN(n) || n < 0) errors.initialBuy = 'Initial buy must be a non-negative number';
	}
	return { ok: Object.keys(errors).length === 0, errors };
}

/** Validate then call onSubmit(fields) if valid. Returns { ok, errors? }. */
export function handleLaunchSubmit(fields, onSubmit) {
	const result = validateLaunchForm(fields);
	if (!result.ok) return result;
	onSubmit(fields);
	return { ok: true };
}

function escHtml(s) {
	return String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

/**
 * Mount the launch panel into `container`.
 * opts.onSubmit(fields) — called when form passes validation.
 *   If omitted, dispatches pump-launch-open CustomEvent (consumed by mountPumpModals
 *   when loaded on the same page).
 * Returns a teardown() function.
 */
export function mountLaunchPanel(container, { onSubmit } = {}) {
	const tierOpts = FEE_TIERS.map(
		([v, l]) => `<option value="${escHtml(v)}">${escHtml(l)}</option>`,
	).join('');

	container.innerHTML = `
<div class="launch-panel">
	<p class="muted launch-panel-desc">
		Launch a pump.fun bonding-curve token for this agent.
		Fill in the details and submit — you'll sign one transaction with your Solana wallet.
	</p>

	<label class="field">
		<span>Token name <span class="launch-req">*</span></span>
		<input type="text" name="lp-name" maxlength="32" placeholder="My Agent Token" />
		<span class="launch-field-err" id="lp-err-name" hidden></span>
	</label>

	<label class="field">
		<span>Symbol <span class="launch-req">*</span></span>
		<input type="text" name="lp-symbol" maxlength="10" placeholder="AGENT" />
		<span class="launch-field-err" id="lp-err-symbol" hidden></span>
	</label>

	<label class="field">
		<span>Token image</span>
		<input type="file" name="lp-image" accept="image/*" class="launch-file-input" />
		<span class="muted" style="font-size:0.72rem">PNG or JPG — square recommended.</span>
	</label>

	<label class="field">
		<span>Description <span class="launch-req">*</span></span>
		<textarea name="lp-description" rows="3" maxlength="500" placeholder="What does this agent do?"></textarea>
		<span class="launch-field-err" id="lp-err-description" hidden></span>
	</label>

	<label class="field">
		<span>Initial buy (SOL)</span>
		<input type="number" name="lp-initial-buy" min="0" max="50" step="0.01" value="0" />
		<span class="muted" style="font-size:0.72rem">Optional creator buy-in on launch. 0 = no buy.</span>
		<span class="launch-field-err" id="lp-err-initialbuy" hidden></span>
	</label>

	<label class="field">
		<span>Fee tier</span>
		<select name="lp-fee-tier">${tierOpts}</select>
	</label>

	<div class="bonding-curve-preview">
		<div class="bonding-curve-header">
			<span class="muted" style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em">Bonding curve</span>
			<span id="lp-curve-pct" class="bonding-curve-pct">0%</span>
		</div>
		<div class="bonding-curve-track">
			<div class="bonding-curve-fill" id="lp-curve-fill" style="width:0%"></div>
		</div>
		<div class="bonding-curve-labels">
			<span>Genesis</span>
			<span>Graduation ($69k)</span>
		</div>
	</div>

	<div class="launch-field-err" id="lp-err-global" style="margin-bottom:0.5rem" hidden></div>

	<button type="button" class="btn-primary" id="lp-submit" style="width:100%">
		Launch token
	</button>
</div>`;

	const q = (sel) => container.querySelector(sel);

	function getFields() {
		return {
			name: q('[name="lp-name"]').value,
			symbol: q('[name="lp-symbol"]').value.toUpperCase().trim(),
			description: q('[name="lp-description"]').value,
			initialBuy: q('[name="lp-initial-buy"]').value,
			feeTier: q('[name="lp-fee-tier"]').value,
			image: q('[name="lp-image"]').files?.[0] ?? null,
		};
	}

	function clearErrors() {
		for (const el of container.querySelectorAll('.launch-field-err')) {
			el.hidden = true;
			el.textContent = '';
		}
	}

	function showErr(id, msg) {
		const el = q(`#${id}`);
		if (!el) return;
		el.textContent = msg;
		el.hidden = false;
	}

	function updateCurve() {
		const f = getFields();
		const filled = [f.name.trim(), f.symbol.trim(), f.description.trim()].filter(Boolean).length;
		// Visual only: max 72% at form-complete — graduation is on-chain
		const pct = Math.round((filled / 3) * 72);
		q('#lp-curve-fill').style.width = `${pct}%`;
		q('#lp-curve-pct').textContent = `${pct}%`;
	}

	q('[name="lp-name"]').addEventListener('input', updateCurve);
	q('[name="lp-symbol"]').addEventListener('input', updateCurve);
	q('[name="lp-description"]').addEventListener('input', updateCurve);

	q('#lp-submit').addEventListener('click', () => {
		clearErrors();
		const fields = getFields();

		if (typeof onSubmit === 'function') {
			const result = handleLaunchSubmit(fields, onSubmit);
			if (!result.ok) {
				const e = result.errors;
				if (e.name) showErr('lp-err-name', e.name);
				if (e.symbol) showErr('lp-err-symbol', e.symbol);
				if (e.description) showErr('lp-err-description', e.description);
				if (e.initialBuy) showErr('lp-err-initialbuy', e.initialBuy);
			}
			return;
		}

		const { ok, errors } = validateLaunchForm(fields);
		if (!ok) {
			if (errors.name) showErr('lp-err-name', errors.name);
			if (errors.symbol) showErr('lp-err-symbol', errors.symbol);
			if (errors.description) showErr('lp-err-description', errors.description);
			if (errors.initialBuy) showErr('lp-err-initialbuy', errors.initialBuy);
			return;
		}

		// TODO: load pump-modals.js in the studio HTML to enable the full on-chain flow.
		// For now dispatch the event (consumed by mountPumpModals when present) and
		// log so the form submission is visible in the console for smoke testing.
		console.log('[launch-panel] submit', fields);
		if (typeof window !== 'undefined') {
			window.dispatchEvent(
				new CustomEvent('pump-launch-open', {
					detail: { identity: { name: fields.name }, formData: fields },
				}),
			);
		}
	});

	return function teardown() {
		container.innerHTML = '';
	};
}
