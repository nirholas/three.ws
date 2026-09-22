// Inbound spam and malware verdicts for agent mail.
//
// The provider receives on Amazon SES infrastructure, which stamps every
// message with verdict headers before we see it:
//   X-SES-Spam-Verdict   PASS | FAIL | GRAY | PROCESSING_FAILED
//   X-SES-Virus-Verdict  PASS | FAIL | GRAY | PROCESSING_FAILED
//   Authentication-Results  spf=, dkim=, dmarc= results for the sender
// scoreInbound() folds those into one 0 to 10 score we store and show. Nothing
// here trusts the sender: a missing header counts as "unknown", never as a pass.

function header(headers, name) {
	if (!headers) return null;
	const want = name.toLowerCase();
	for (const [k, v] of Object.entries(headers)) {
		if (String(k).toLowerCase() === want) return Array.isArray(v) ? v.join(', ') : String(v);
	}
	return null;
}

function verdict(v) {
	const s = String(v || '').trim().toUpperCase();
	if (!s) return 'UNKNOWN';
	if (['PASS', 'FAIL', 'GRAY', 'PROCESSING_FAILED'].includes(s)) return s;
	return 'UNKNOWN';
}

/** Parse spf/dkim/dmarc results out of an Authentication-Results header. */
export function parseAuthResults(value) {
	const out = { spf: 'none', dkim: 'none', dmarc: 'none' };
	const s = String(value || '');
	for (const key of Object.keys(out)) {
		const m = s.match(new RegExp(`\\b${key}\\s*=\\s*([a-z]+)`, 'i'));
		if (m) out[key] = m[1].toLowerCase();
	}
	return out;
}

/**
 * @param {Record<string,string>|null} headers  the message headers as delivered
 * @returns {{ score: number, spamVerdict: string, virusVerdict: string,
 *   auth: { spf: string, dkim: string, dmarc: string }, isSpam: boolean, quarantineAttachments: boolean }}
 */
export function scoreInbound(headers) {
	const spamVerdict = verdict(header(headers, 'x-ses-spam-verdict'));
	const virusVerdict = verdict(header(headers, 'x-ses-virus-verdict'));
	const auth = parseAuthResults(header(headers, 'authentication-results'));

	let score = 0;
	if (spamVerdict === 'FAIL') score += 6;
	else if (spamVerdict === 'GRAY') score += 3;
	else if (spamVerdict !== 'PASS') score += 1;
	if (auth.dmarc === 'fail') score += 3;
	if (auth.spf === 'fail' || auth.spf === 'softfail') score += 1;
	if (auth.dkim === 'fail') score += 1;
	if (virusVerdict === 'FAIL') score += 4;
	score = Math.min(10, score);

	return {
		score,
		spamVerdict,
		virusVerdict,
		auth,
		isSpam: score >= 6,
		// A positive malware verdict keeps the files out of storage entirely.
		// Anything else is stored and only ever served as a download
		// (Content-Disposition: attachment), never rendered inline.
		quarantineAttachments: virusVerdict === 'FAIL',
	};
}
