// Live UK grid carbon intensity over the keyless National Grid ESO Carbon
// Intensity API (api.carbonintensity.org.uk). No API key, no fixture mode.
// National by default; regional when a GB postcode outcode is supplied.

const THREE_WS_UA = 'three.ws/1.0 (+https://three.ws; support@three.ws)';
const API_BASE = 'https://api.carbonintensity.org.uk';
const TIMEOUT_MS = 10_000;

function upstreamError(message, status, code, cause) {
	const err = new Error(message);
	err.status = status;
	err.code = code;
	if (cause) err.cause = cause;
	return err;
}

async function fetchJson(url) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': THREE_WS_UA }, signal: controller.signal });
		const text = await res.text();
		let data;
		try {
			data = text ? JSON.parse(text) : null;
		} catch {
			data = null;
		}
		if (!res.ok) {
			throw upstreamError(`carbon intensity API returned ${res.status}`, res.status >= 500 ? 502 : res.status, res.status === 429 ? 'upstream_rate_limited' : 'upstream_error');
		}
		return data;
	} catch (err) {
		if (err?.status) throw err;
		throw upstreamError('carbon intensity API is unreachable', 504, 'upstream_unreachable', err);
	} finally {
		clearTimeout(timer);
	}
}

function validateOutcode(postcode) {
	const v = String(postcode || '').trim().toUpperCase();
	// Outcode only (e.g. "SW1A", "EH1"), per the upstream API's own contract.
	if (!/^[A-Z]{1,2}[0-9][A-Z0-9]?$/.test(v)) {
		throw upstreamError('postcode must be a GB outcode, e.g. "SW1A" or "EH1"', 400, 'bad_request');
	}
	return v;
}

export async function now(postcode) {
	if (postcode) {
		const outcode = validateOutcode(postcode);
		const data = await fetchJson(`${API_BASE}/regional/postcode/${encodeURIComponent(outcode)}`);
		const region = data?.data?.[0];
		if (!region) throw upstreamError('no regional data for this postcode', 404, 'not_found');
		return {
			scope: 'regional',
			postcode: outcode,
			region: region.shortname,
			from: region.data?.[0]?.from,
			to: region.data?.[0]?.to,
			intensity: region.data?.[0]?.intensity,
			generationmix: region.data?.[0]?.generationmix,
		};
	}
	const [intensity, generation] = await Promise.all([
		fetchJson(`${API_BASE}/intensity`),
		fetchJson(`${API_BASE}/generation`),
	]);
	const point = intensity?.data?.[0];
	if (!point) throw upstreamError('carbon intensity API returned no current reading', 502, 'upstream_error');
	return {
		scope: 'national',
		from: point.from,
		to: point.to,
		intensity: point.intensity,
		generationmix: generation?.data?.generationmix,
	};
}

function windowStats(points) {
	const values = points.map((p) => p.intensity?.forecast).filter((v) => typeof v === 'number');
	const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
	const peak = Math.max(...values);
	return { mean: Number(mean.toFixed(1)), peak, from: points[0]?.from, to: points[points.length - 1]?.to };
}

export async function bestWindow({ hours = 4, postcode } = {}) {
	const slots = Math.max(1, Math.min(24, Math.round(Number(hours) * 2))); // half-hour slots
	const from = new Date().toISOString().slice(0, 16) + 'Z';
	let forecast;
	if (postcode) {
		const outcode = validateOutcode(postcode);
		const data = await fetchJson(`${API_BASE}/regional/intensity/${from}/fw48h/postcode/${encodeURIComponent(outcode)}`);
		forecast = data?.data?.data;
	} else {
		const data = await fetchJson(`${API_BASE}/intensity/${from}/fw48h`);
		forecast = data?.data;
	}
	if (!Array.isArray(forecast) || forecast.length < slots) {
		throw upstreamError('carbon intensity API returned an incomplete forecast window', 502, 'upstream_error');
	}

	const candidates = [];
	for (let i = 0; i + slots <= forecast.length; i++) {
		candidates.push({ startIdx: i, ...windowStats(forecast.slice(i, i + slots)) });
	}
	candidates.sort((a, b) => a.mean - b.mean);
	const best = candidates[0];
	const worst = candidates[candidates.length - 1];
	const runnersUp = [];
	for (const c of candidates.slice(1)) {
		if (runnersUp.length >= 3) break;
		const overlaps = runnersUp.some((r) => Math.abs(r.startIdx - c.startIdx) < slots) || Math.abs(best.startIdx - c.startIdx) < slots;
		if (!overlaps) runnersUp.push(c);
	}

	const nowPoint = forecast[0];
	const nowIntensity = nowPoint?.intensity?.forecast;
	const savingsPct = nowIntensity ? Math.round(((nowIntensity - best.mean) / nowIntensity) * 100) : null;
	let recommendation;
	if (best.mean <= 50) {
		recommendation = `Grid is near-zero carbon in the best window (${best.from} to ${best.to}, avg ${best.mean} gCO2/kWh). Run flexible loads then.`;
	} else if (savingsPct != null && savingsPct < 10) {
		recommendation = `Little variation ahead: the best window (${best.from} to ${best.to}) only saves about ${savingsPct}% over now. Timing shift is marginal.`;
	} else {
		recommendation = `Best window ${best.from} to ${best.to} averages ${best.mean} gCO2/kWh${savingsPct != null ? `, about ${savingsPct}% below the current reading` : ''}.`;
	}

	return {
		scope: postcode ? 'regional' : 'national',
		postcode: postcode ? validateOutcode(postcode) : undefined,
		hoursRequested: hours,
		best: { from: best.from, to: best.to, meanIntensity: best.mean, peakIntensity: best.peak },
		worst: { from: worst.from, to: worst.to, meanIntensity: worst.mean, peakIntensity: worst.peak },
		runnersUp: runnersUp.map((r) => ({ from: r.from, to: r.to, meanIntensity: r.mean, peakIntensity: r.peak })),
		recommendation,
	};
}
