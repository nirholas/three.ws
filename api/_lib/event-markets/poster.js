// The single place an Event Market announcement is sent to X. It refuses
// anything that is not `approved`, re-checks the text, enforces the daily cap,
// and sends nothing unless EVENT_MARKET_ANNOUNCE_POST=on and dryRun is false.
//
// Sends through @trythreews with the same OAuth 1.0a client as the x-content
// publisher (api/_lib/x-content/publisher.js), so the account's own cadence and
// credentials apply. Dry run uses that module's previewClient and prints the
// exact call a live send would make.

import { sql } from '../db.js';
import { CONFIG } from './announce.js';
import { textProblems } from './review.js';
import { previewClient, xClientFromEnv } from '../x-content/publisher.js';

export class PosterError extends Error {
	constructor(code, message, status = 409) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

export const postingEnabled = (env = process.env) => String(env.EVENT_MARKET_ANNOUNCE_POST || '').toLowerCase() === 'on';

export async function sendAnnouncement(id, { dryRun = true, client = null, env = process.env } = {}) {
	const [row] = await sql`select * from event_market_announcements where id = ${id}`;
	if (!row) throw new PosterError('not_found', 'announcement not found', 404);
	if (row.status !== 'approved') throw new PosterError('not_approved', `refusing to send: status is ${row.status}, only approved announcements are sent`);
	const problems = textProblems(row.draft_text, row.tags);
	if (problems.length) throw new PosterError('unsendable', `refusing to send: ${problems.join('; ')}`);

	const [{ n }] = await sql`
		select count(*)::int as n from event_market_announcements
		where status = 'posted' and posted_at > now() - interval '24 hours'
	`;
	const cap = CONFIG.dailyCap;
	if (n >= cap) throw new PosterError('daily_cap', `daily cap of ${cap} announcements reached; try again after the oldest ages out of the 24 hour window`, 429);

	const payload = { text: row.draft_text };
	if (dryRun) {
		const preview = previewClient();
		await preview.tweet(payload);
		return { dry_run: true, would_send: payload, calls: preview.calls, flag_on: postingEnabled(env) };
	}
	if (!postingEnabled(env)) throw new PosterError('posting_disabled', 'posting is off: set EVENT_MARKET_ANNOUNCE_POST=on to send approved announcements', 403);

	const x = client || (await xClientFromEnv(env));
	if (!x) throw new PosterError('not_configured', 'X credentials are not configured (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET)', 501);

	const [claimed] = await sql`
		update event_market_announcements set status = 'posting', updated_at = now()
		where id = ${id} and status = 'approved' returning id
	`;
	if (!claimed) throw new PosterError('conflict', 'another send already claimed this announcement');
	let res;
	try {
		res = await x.tweet(payload);
	} catch (err) {
		await sql`update event_market_announcements set status = 'approved', updated_at = now() where id = ${id} and status = 'posting'`;
		throw new PosterError('send_failed', `X rejected the post: ${String(err?.message || err).slice(0, 200)}`, 502);
	}
	const postId = res?.data?.id;
	const url = postId ? `https://x.com/i/status/${postId}` : null;
	const [out] = await sql`
		update event_market_announcements set status = 'posted', posted_at = now(), post_url = ${url}, updated_at = now()
		where id = ${id} returning *
	`;
	return { dry_run: false, sent: payload, announcement: out };
}
